"""持久 Turn 的接纳、转换与重启恢复反例。"""

from __future__ import annotations

import asyncio
import sqlite3
import threading
from dataclasses import replace
from pathlib import Path

import pytest
from glimmer_cradle.conversation import (
    ConversationTurn,
    SqliteTurnStore,
    TurnConflictError,
    TurnController,
    TurnTransitionError,
)


class Clock:
    def __init__(self) -> None:
        self.value = "2026-01-01T00:00:00Z"

    def now_iso(self) -> str:
        return self.value

    async def wait(self, _seconds: float) -> None:
        return None


def candidate(turn_id: str = "turn:1", *, thread_id: str = "main") -> ConversationTurn:
    return ConversationTurn(
        turn_id=turn_id,
        scene_id="scene:test",
        conversation_id="conversation:test",
        continuity_id="continuity:test",
        thread_id=thread_id,
        payload_digest="sha256:turn-payload",
    )


async def test_turn_accept_is_idempotent_and_context_conflict_is_rejected(
    tmp_path: Path,
) -> None:
    clock = Clock()
    controller = TurnController(SqliteTurnStore(tmp_path / "turns.db"), clock=clock)
    assert await controller.connect() == 0

    accepted = await controller.accept(candidate())
    replay = await controller.accept(candidate())
    assert replay == accepted
    assert accepted.status == "accepted"
    assert accepted.revision == 1
    assert accepted.accepted_at == clock.value

    with pytest.raises(TurnConflictError, match="已绑定不同上下文"):
        await controller.accept(candidate(thread_id="topic:other"))
    with pytest.raises(TurnConflictError, match="已绑定不同上下文"):
        await controller.accept(replace(candidate(), payload_digest="sha256:different"))
    await controller.close()


async def test_turn_transitions_are_durable_and_optimistically_serialized(
    tmp_path: Path,
) -> None:
    clock = Clock()
    database = tmp_path / "turns.db"
    controller = TurnController(SqliteTurnStore(database), clock=clock)
    await controller.connect()
    accepted = await controller.accept(candidate())

    clock.value = "2026-01-01T00:00:01Z"
    running = await controller.start(accepted.turn_id, expected_revision=accepted.revision)
    assert running.status == "running" and running.revision == 2
    assert await controller.start(running.turn_id, expected_revision=running.revision) == running
    with pytest.raises(TurnConflictError, match="修订冲突"):
        await controller.complete(running.turn_id, expected_revision=accepted.revision)

    clock.value = "2026-01-01T00:00:02Z"
    completed = await controller.complete(running.turn_id, expected_revision=running.revision)
    assert completed.status == "completed" and completed.revision == 3
    with pytest.raises(TurnTransitionError, match="非法转换"):
        await controller.fail(completed.turn_id, expected_revision=completed.revision, reason="late")
    await controller.close()

    restarted = TurnController(SqliteTurnStore(database), clock=clock)
    assert await restarted.connect() == 0
    assert await restarted.load(completed.turn_id) == completed
    await restarted.close()


async def test_restart_marks_non_terminal_turn_interrupted(tmp_path: Path) -> None:
    clock = Clock()
    database = tmp_path / "turns.db"
    first = TurnController(SqliteTurnStore(database), clock=clock)
    await first.connect()
    accepted = await first.accept(candidate("turn:recover"))
    running = await first.start(accepted.turn_id, expected_revision=accepted.revision)
    await first.close()

    clock.value = "2026-01-01T00:01:00Z"
    restarted = TurnController(SqliteTurnStore(database), clock=clock)
    assert await restarted.connect() == 1
    recovered = await restarted.load(running.turn_id)
    assert recovered is not None
    assert recovered.status == "interrupted"
    assert recovered.revision == running.revision + 1
    assert recovered.terminal_reason == "process_restarted"
    assert recovered.updated_at == clock.value
    await restarted.close()


async def test_interrupted_and_failed_turns_require_reason(tmp_path: Path) -> None:
    controller = TurnController(SqliteTurnStore(tmp_path / "turns.db"), clock=Clock())
    await controller.connect()
    accepted = await controller.accept(candidate())
    with pytest.raises(ValueError, match="必须提供 reason"):
        await controller.interrupt(accepted.turn_id, expected_revision=accepted.revision, reason=" ")
    with pytest.raises(ValueError, match="必须提供 reason"):
        await controller.fail(accepted.turn_id, expected_revision=accepted.revision, reason="")
    await controller.close()


async def test_legacy_turn_without_digest_is_migrated_and_fails_closed(
    tmp_path: Path,
) -> None:
    database = tmp_path / "legacy-turns.db"
    with sqlite3.connect(database) as connection:
        connection.executescript(
            """CREATE TABLE conversation_turns(
              turn_id TEXT PRIMARY KEY, scene_id TEXT NOT NULL,
              conversation_id TEXT NOT NULL, continuity_id TEXT NOT NULL,
              thread_id TEXT NOT NULL, recall_scope TEXT NOT NULL,
              disclosure_scope TEXT NOT NULL, status TEXT NOT NULL,
              revision INTEGER NOT NULL, accepted_at TEXT NOT NULL,
              updated_at TEXT NOT NULL, terminal_reason TEXT
            );
            INSERT INTO conversation_turns VALUES(
              'turn:legacy','scene:test','conversation:test','continuity:test',
              'main','conversation_private','conversation_private','completed',1,
              '2025-01-01T00:00:00Z','2025-01-01T00:00:00Z',NULL
            );"""
        )

    controller = TurnController(SqliteTurnStore(database), clock=Clock())
    await controller.connect()
    loaded = await controller.load("turn:legacy")
    assert loaded is not None and loaded.payload_digest == ""
    with pytest.raises(TurnConflictError, match="已绑定不同上下文"):
        await controller.accept(candidate("turn:legacy"))
    await controller.close()


async def test_turn_cancelled_sql_statement_drains_rollback_before_reader_or_next_write(tmp_path):
    store = SqliteTurnStore(tmp_path / "turns.db")
    await store.connect()
    entered, release = asyncio.Event(), threading.Event()
    loop = asyncio.get_running_loop()

    def wait():
        loop.call_soon_threadsafe(entered.set)
        if not release.wait(5):
            raise RuntimeError("fixture wait timeout")
        return 1

    await store._conn.create_function("fixture_wait", 0, wait)
    await store._conn.execute("CREATE TRIGGER fixture_wait BEFORE INSERT ON conversation_turns BEGIN SELECT fixture_wait(); END")
    await store._conn.commit()
    task = asyncio.create_task(store.create(candidate().accepted(Clock().value)))
    try:
        await asyncio.wait_for(entered.wait(), 2)
        task.cancel()
        reader = asyncio.create_task(store.load("turn:1"))
        await asyncio.sleep(0.02)
        assert not task.done() and not reader.done()
        task.cancel()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert await reader is None
        assert not store._conn.in_transaction
        await store._conn.execute("DROP TRIGGER fixture_wait")
        await store._conn.commit()
        assert await store.create(candidate().accepted(Clock().value)) == candidate().accepted(Clock().value)
    finally:
        release.set()
        await asyncio.gather(task, return_exceptions=True)
        await store.close()


async def test_turn_cancelled_commit_is_drained_and_actual_committed_fact_remains_replayable(tmp_path, monkeypatch):
    store = SqliteTurnStore(tmp_path / "turns.db")
    await store.connect()
    entered, release = asyncio.Event(), asyncio.Event()
    original = store._conn.commit

    async def commit():
        await original()
        entered.set()
        await release.wait()

    monkeypatch.setattr(store._conn, "commit", commit)
    accepted = candidate().accepted(Clock().value)
    task = asyncio.create_task(store.create(accepted))
    try:
        await asyncio.wait_for(entered.wait(), 2)
        task.cancel()
        reader = asyncio.create_task(store.load("turn:1"))
        await asyncio.sleep(0.02)
        assert not reader.done() and not task.done()
        task.cancel()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert await reader == accepted
        monkeypatch.setattr(store._conn, "commit", original)
        assert await store.create(accepted) == accepted
    finally:
        release.set()
        await asyncio.gather(task, return_exceptions=True)
        await store.close()


async def test_turn_controller_cancelled_recovery_releases_connection_and_can_reconnect(tmp_path, monkeypatch):
    store = SqliteTurnStore(tmp_path / "turns.db")
    controller = TurnController(store, clock=Clock())
    entered = asyncio.Event()
    original = store.recover_active

    async def recover_active(**kwargs):
        await original(**kwargs)
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(store, "recover_active", recover_active)
    task = asyncio.create_task(controller.connect())
    try:
        await asyncio.wait_for(entered.wait(), 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not controller._connected and store._conn is None
        monkeypatch.setattr(store, "recover_active", original)
        assert await controller.connect() == 0
        assert await controller.accept(candidate())
    finally:
        await controller.close()
