from __future__ import annotations

from pathlib import Path

import pytest

from glimmer_cradle.cognition.adapters.clock import SystemClock
from glimmer_cradle.cognition.adapters.persistence.sqlite_state_store import SqliteStateStore
from glimmer_cradle.cognition.state import (
    CognitiveActivityController,
    CognitiveActivityState,
    StoredCognitiveState,
    decay_intensity,
)
from tests.conftest import OBSERVABILITY, build_experience_recorder


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
        clock=SystemClock(),
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
        clock=SystemClock(),
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
