from __future__ import annotations

from pathlib import Path

import pytest

from glimmer_cradle.cognition.activity import (
    ActivityTransitionConfig,
    CognitiveActivityController,
    CognitiveActivityState,
    POLICY_BY_STATE,
    evaluate_transition,
    policy_for,
)
from glimmer_cradle.cognition.activity.projection import project_activity_history
from glimmer_cradle.cognition.experience.events import MomentKind
from glimmer_cradle.cognition.experience.recorder import ExperienceRecorder

CFG = ActivityTransitionConfig(
    engaged_to_ambient_idle_s=120,
    ambient_to_quiescent_idle_s=600,
    minimum_residence_s=10,
    affect_activation_hold_threshold=0.8,
)


def transition(
    state: CognitiveActivityState,
    *,
    direct_idle: float = 0,
    observed_idle: float = 0,
    elapsed: float = 20,
    activation: float = 0,
    engage: bool = False,
    observe: bool = False,
):
    return evaluate_transition(
        state,
        direct_idle_seconds=direct_idle,
        observed_idle_seconds=observed_idle,
        state_elapsed_seconds=elapsed,
        affect_activation=activation,
        engage_requested=engage,
        observed_activity_requested=observe,
        config=CFG,
    )


def test_direct_interaction_enters_engaged() -> None:
    result = transition(CognitiveActivityState.QUIESCENT, engage=True)
    assert result.state == CognitiveActivityState.ENGAGED
    assert result.changed is True


def test_ambient_observation_only_enters_ambient() -> None:
    result = transition(CognitiveActivityState.QUIESCENT, observe=True)
    assert result.state == CognitiveActivityState.AMBIENT


def test_engaged_decays_after_direct_idle() -> None:
    result = transition(CognitiveActivityState.ENGAGED, direct_idle=121)
    assert result.state == CognitiveActivityState.AMBIENT
    assert result.reason == "engagement_decayed"


def test_minimum_residence_prevents_immediate_decay() -> None:
    result = transition(
        CognitiveActivityState.ENGAGED,
        direct_idle=121,
        elapsed=5,
    )
    assert result.state == CognitiveActivityState.ENGAGED


def test_affect_activation_holds_current_activity() -> None:
    result = transition(
        CognitiveActivityState.AMBIENT,
        observed_idle=601,
        activation=0.9,
    )
    assert result.state == CognitiveActivityState.AMBIENT
    assert result.reason == "affect_activation_hold"


def test_ambient_decays_to_quiescent() -> None:
    result = transition(CognitiveActivityState.AMBIENT, observed_idle=601)
    assert result.state == CognitiveActivityState.QUIESCENT


def test_quiescent_has_no_automatic_maintenance_cycle() -> None:
    result = transition(
        CognitiveActivityState.QUIESCENT,
        direct_idle=10000,
        observed_idle=10000,
        elapsed=10000,
    )
    assert result.state == CognitiveActivityState.QUIESCENT
    assert result.changed is False


def test_policy_table_covers_all_states() -> None:
    assert set(POLICY_BY_STATE) == set(CognitiveActivityState)
    assert (
        policy_for(CognitiveActivityState.ENGAGED).frequency_hint_ms
        < policy_for(CognitiveActivityState.QUIESCENT).frequency_hint_ms
    )


@pytest.mark.asyncio
async def test_transitions_do_not_write_experience(tmp_path: Path) -> None:
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    controller = CognitiveActivityController(
        experience_recorder=recorder,
        affect_activation_provider=lambda: 0.0,
        tick_interval_s=60,
    )
    try:
        await controller.start()
        controller.engage("direct_perception")
        controller.observe_activity("ambient_perception")
    finally:
        await controller.stop()
        await recorder.stop()
    assert recorder.recent_moments(limit=20) == []


@pytest.mark.asyncio
async def test_projection_uses_real_experience_only(tmp_path: Path) -> None:
    recorder = ExperienceRecorder(tmp_path)
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
