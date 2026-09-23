from pathlib import Path

import pytest

from glimmer_cradle.cognition.adapters.persistence.sqlite_checkpoint_store import (
    SqliteCheckpointStore,
)
from glimmer_cradle.cognition.loop import LoopCheckpoint, recover_checkpoint
from glimmer_cradle.cognition.attention import AttentionController
from glimmer_cradle.cognition.loop import LoopController
from tests.conftest import CLOCK, IDS, OBSERVABILITY, build_experience_recorder


async def test_loop_checkpoint_survives_restart_and_fences_stale_writer(
    tmp_path: Path,
) -> None:
    path = tmp_path / "checkpoints.sqlite"
    store = SqliteCheckpointStore(path)
    await store.connect()
    saved = await store.save(
        LoopCheckpoint("main", cycle_count=7, status="running", revision=0),
        expected_revision=0,
    )
    assert saved.revision == 1
    await store.close()

    reopened = SqliteCheckpointStore(path)
    await reopened.connect()
    recovered = await reopened.load("main")
    assert recovered is not None
    assert recover_checkpoint(recovered).status == "interrupted"
    with pytest.raises(RuntimeError, match="revision conflict"):
        await reopened.save(
            LoopCheckpoint("main", cycle_count=8, status="completed", revision=0),
            expected_revision=0,
        )
    completed = await reopened.save(
        LoopCheckpoint("main", cycle_count=8, status="completed", revision=1),
        expected_revision=1,
    )
    await reopened.close()
    assert completed.revision == 2
    assert completed.cycle_count == 8


async def test_loop_controller_restores_cycle_count_and_checkpoints_stop(
    tmp_path: Path,
) -> None:
    store = SqliteCheckpointStore(tmp_path / "checkpoints.sqlite")
    await store.connect()
    await store.save(
        LoopCheckpoint("main", cycle_count=11, status="running", revision=0),
        expected_revision=0,
    )
    recorder = build_experience_recorder(tmp_path / "conversation")
    await recorder.start()
    controller = LoopController(
        workspace=AttentionController(capacity=3, clock=CLOCK),
        providers=[],
        experience_recorder=recorder,
        checkpoint_store=store,
        default_tick_interval_ms=60_000,
        clock=CLOCK,
        ids=IDS,
        observability=OBSERVABILITY,
    )
    await controller.start()
    assert controller.cycle_count == 11
    await controller.stop()
    checkpoint = await store.load("main")
    await recorder.stop()
    await store.close()
    assert checkpoint is not None
    assert checkpoint.status == "stopped"
    assert checkpoint.cycle_count == 11
    assert checkpoint.revision == 4
