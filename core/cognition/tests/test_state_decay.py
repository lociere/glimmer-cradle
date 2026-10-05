from __future__ import annotations

from pathlib import Path

import pytest

from glimmer_cradle.cognition.adapters.persistence.sqlite_state_store import SqliteStateStore
from glimmer_cradle.cognition.state import (
    ActivityTransitionConfig,
    CognitiveActivityController,
    CognitiveActivityState,
    POLICY_BY_STATE,
    StoredCognitiveState,
    decay_intensity,
    evaluate_transition,
    policy_for,
    project_activity_history,
)
from glimmer_cradle.conversation.log import MomentKind
from tests.conftest import OBSERVABILITY, TestClock as _TestClock, build_experience_recorder


def test_affect_decay_is_pure_bounded_and_time_based() -> None:
    assert decay_intensity(0.8, elapsed_seconds=100) == pytest.approx(0.72)
    assert decay_intensity(0.8, elapsed_seconds=-5) == pytest.approx(0.8)
    assert decay_intensity(0.8, elapsed_seconds=100000) == pytest.approx(0.1)


@pytest.mark.asyncio
async def test_sqlite_state_store_persists_revision_and_rejects_conflict(
    tmp_path: Path,
) -> None:
    path = tmp_path / "state.db"
    store = SqliteStateStore(path)
    await store.connect()
    first = await store.save(
        StoredCognitiveState("activity", 0, {"state": "ambient"}, "2026-01-01T00:00:00Z"),
        expected_revision=None,
    )
    assert first.revision == 1
    with pytest.raises(RuntimeError, match="revision conflict"):
        await store.save(first, expected_revision=None)
    await store.close()

    reopened = SqliteStateStore(path)
    await reopened.connect()
    restored = await reopened.load("activity")
    await reopened.close()
    assert restored == first


@pytest.mark.asyncio
async def test_activity_controller_restores_persisted_direct_activity(
    tmp_path: Path,
) -> None:
    recorder = build_experience_recorder(tmp_path / "experience")
    await recorder.start()
    store = SqliteStateStore(tmp_path / "state.db")
    await store.connect()
    first = CognitiveActivityController(
        experience_recorder=recorder,
        affect_activation_provider=lambda: 0.0,
        clock=_TestClock(),
        observability=OBSERVABILITY,
        state_store=store,
        tick_interval_s=60,
    )
    await first.start()
    first.engage()
    await first.stop()

    restored = CognitiveActivityController(
        experience_recorder=recorder,
        affect_activation_provider=lambda: 0.0,
        clock=_TestClock(),
        observability=OBSERVABILITY,
        state_store=store,
        tick_interval_s=60,
    )
    await restored.start()
    try:
        assert restored.state == CognitiveActivityState.ENGAGED
    finally:
        await restored.stop()
        await store.close()
        await recorder.stop()


_TRANSITION_CONFIG = ActivityTransitionConfig(
    engaged_to_ambient_idle_s=120,
    ambient_to_quiescent_idle_s=600,
    minimum_residence_s=10,
    affect_activation_hold_threshold=0.8,
)


@pytest.mark.parametrize(
    ("state", "expected", "values"),
    [
        (CognitiveActivityState.QUIESCENT, CognitiveActivityState.ENGAGED, {"engage_requested": True}),
        (CognitiveActivityState.QUIESCENT, CognitiveActivityState.AMBIENT, {"observed_activity_requested": True}),
        (CognitiveActivityState.ENGAGED, CognitiveActivityState.AMBIENT, {"direct_idle_seconds": 121}),
        (CognitiveActivityState.ENGAGED, CognitiveActivityState.ENGAGED, {"direct_idle_seconds": 121, "state_elapsed_seconds": 5}),
        (CognitiveActivityState.AMBIENT, CognitiveActivityState.AMBIENT, {"observed_idle_seconds": 601, "affect_activation": 0.9}),
        (CognitiveActivityState.AMBIENT, CognitiveActivityState.QUIESCENT, {"observed_idle_seconds": 601}),
    ],
)
def test_activity_transition_policy(
    state: CognitiveActivityState,
    expected: CognitiveActivityState,
    values: dict,
) -> None:
    arguments = {
        "direct_idle_seconds": 0,
        "observed_idle_seconds": 0,
        "state_elapsed_seconds": 20,
        "affect_activation": 0,
        "engage_requested": False,
        "observed_activity_requested": False,
        **values,
    }
    result = evaluate_transition(state, config=_TRANSITION_CONFIG, **arguments)
    assert result.state == expected


def test_activity_policy_covers_every_state_and_quiescent_stays_idle() -> None:
    assert set(POLICY_BY_STATE) == set(CognitiveActivityState)
    assert (
        policy_for(CognitiveActivityState.ENGAGED).frequency_hint_ms
        < policy_for(CognitiveActivityState.QUIESCENT).frequency_hint_ms
    )
    result = evaluate_transition(
        CognitiveActivityState.QUIESCENT,
        direct_idle_seconds=10000,
        observed_idle_seconds=10000,
        state_elapsed_seconds=10000,
        affect_activation=0,
        engage_requested=False,
        observed_activity_requested=False,
        config=_TRANSITION_CONFIG,
    )
    assert result.state == CognitiveActivityState.QUIESCENT
    assert result.changed is False


async def test_activity_transitions_do_not_write_conversation_facts(
    tmp_path: Path,
) -> None:
    recorder = build_experience_recorder(tmp_path)
    await recorder.start()
    controller = CognitiveActivityController(
        experience_recorder=recorder,
        clock=_TestClock(),
        observability=OBSERVABILITY,
        affect_activation_provider=lambda: 0.0,
        tick_interval_s=60,
    )
    await controller.start()
    controller.engage("direct_perception")
    controller.observe_activity("ambient_perception")
    await controller.stop()
    await recorder.stop()
    assert recorder.recent_moments(limit=20) == []


async def test_activity_projection_uses_real_conversation_facts(tmp_path: Path) -> None:
    recorder = build_experience_recorder(tmp_path)
    await recorder.start()
    recorder.record(
        MomentKind.PERCEPTION,
        content={"text": "你好", "address_mode": "direct"},
    )
    recorder.record(MomentKind.REPLY, content={"text": "晚上好"})
    await recorder.flush()
    history = project_activity_history(recorder)
    await recorder.stop()
    assert history.direct_at is not None
    assert history.observed_at is not None
    assert history.self_at is not None
