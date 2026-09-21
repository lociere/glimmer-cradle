from __future__ import annotations

import asyncio
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import uuid

import pytest

from glimmer_cradle.conversation import (
    ConversationController,
    ConversationStore,
    MomentKind,
    build_conversation_recorder,
)


class Clock:
    def now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    async def wait(self, _seconds: float) -> None:
        await asyncio.sleep(_seconds)


class Ids:
    def new(self) -> str:
        return uuid.uuid4().hex


class Logger:
    def info(self, _event: str, **_values) -> None:
        return None

    def warning(self, _event: str, **_values) -> None:
        return None

    def error(self, _event: str, **_values) -> None:
        return None


class Observability:
    def logger(self, _module_name: str) -> Logger:
        return Logger()

    def current_trace_id(self) -> str | None:
        return None


def recorder(path: Path):
    return build_conversation_recorder(
        path,
        clock=Clock(),
        ids=Ids(),
        observability=Observability(),
        flush_interval_ms=60_000,
    )


def projection_config():
    return SimpleNamespace(
        segment_target_messages=2,
        chapter_idle_minutes=360,
        chapter_segment_limit=8,
        state_update_messages=1,
        history_candidate_limit=12,
        history_result_limit=4,
        summary_max_chars=2400,
    )


def working_config():
    return SimpleNamespace(
        max_messages_per_conversation=16,
        hydrate_recent_messages=16,
        context_message_limit=16,
    )


async def test_log_is_single_writer_and_resumes_global_position(tmp_path: Path) -> None:
    first = recorder(tmp_path / "log")
    competing = recorder(tmp_path / "log")
    await first.start()
    first.record(MomentKind.PERCEPTION, {"text": "第一条"})
    try:
        await competing.start()
    except RuntimeError as error:
        assert "已有写入者" in str(error)
    else:
        raise AssertionError("同一 Conversation Log 不得同时存在两个 writer")
    await first.stop()

    restarted = recorder(tmp_path / "log")
    await restarted.start()
    second = restarted.record(MomentKind.REPLY, {"text": "第二条"})
    await restarted.stop()
    assert second is not None and second.seq == 2


async def test_history_rebuilds_only_from_ordered_log(tmp_path: Path) -> None:
    log = recorder(tmp_path / "log")
    await log.start()
    common = {
        "scene_id": "scene:test",
        "conversation_id": "conversation:test",
        "continuity_id": "continuity:test",
        "thread_id": "main",
        "interaction_id": "turn:test",
    }
    log.record(MomentKind.PERCEPTION, {"text": "你好"}, **common)
    log.record(MomentKind.REPLY, {"text": "晚上好"}, **common)
    await log.flush()

    database = tmp_path / "history.db"
    controller = ConversationController(
        store=ConversationStore(database, config=projection_config()),
        recorder=log,
        working_config=working_config(),
    )
    await controller.connect()
    _, recent, _ = await controller.prompt_context(
        "conversation:test", "main", "你好",
        allowed_scopes={"conversation_private"}
    )
    await controller.close()
    database.unlink()

    rebuilt = ConversationController(
        store=ConversationStore(database, config=projection_config()),
        recorder=log,
        working_config=working_config(),
    )
    await rebuilt.connect()
    _, rebuilt_recent, _ = await rebuilt.prompt_context(
        "conversation:test", "main", "你好",
        allowed_scopes={"conversation_private"}
    )
    await rebuilt.close()
    await log.stop()
    assert rebuilt_recent == recent
    assert "user: 你好" in recent and "assistant: 晚上好" in recent


async def test_transient_fact_never_enters_durable_log(tmp_path: Path) -> None:
    log = recorder(tmp_path / "log")
    await log.start()
    assert log.record(
        MomentKind.PERCEPTION,
        {"text": "只供当拍"},
        retention_ceiling="transient",
    ) is None
    await log.stop()
    assert log.log.query() == []


async def test_log_verification_reports_a_corrupted_position_gap(tmp_path: Path) -> None:
    base_dir = tmp_path / "log"
    log = recorder(base_dir)
    await log.start()
    log.record(MomentKind.PERCEPTION, {"text": "第一条"})
    log.record(MomentKind.REPLY, {"text": "第二条"})
    await log.stop()

    pack = next((base_dir / "packs").rglob("*.experience.db"))
    with sqlite3.connect(pack) as connection:
        connection.execute("DELETE FROM moments WHERE position = 1")
        connection.commit()

    result = recorder(base_dir).verify()
    assert result["ok"] is False
    assert result["position_gaps"] == [1]


async def test_pack_commit_then_catalog_failure_retries_idempotently(tmp_path: Path) -> None:
    base_dir = tmp_path / "log"
    subject = recorder(base_dir)
    await subject.start()
    original = subject.log._reconcile_catalog
    attempts = 0

    def fail_once() -> None:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise OSError("injected catalog failure")
        original()

    subject.log._reconcile_catalog = fail_once
    first = subject.record(MomentKind.PERCEPTION, {"text": "只写一次"})
    with pytest.raises(OSError, match="catalog failure"):
        await subject.flush()
    assert [item.moment_id for item in subject.log.query()] == [first.moment_id]

    await subject.flush()
    await subject.stop()
    restarted = recorder(base_dir)
    await restarted.start()
    second = restarted.record(MomentKind.REPLY, {"text": "继续递增"})
    await restarted.stop()
    assert [item.seq for item in restarted.log.query()] == [1, 2]
    assert second is not None and second.seq == 2


async def test_concurrent_flushes_are_serialized(tmp_path: Path) -> None:
    subject = recorder(tmp_path / "log")
    await subject.start()
    subject.record(MomentKind.PERCEPTION, {"text": "第一条"})
    original = subject.log._write_batch
    entered = threading.Event()
    release = threading.Event()
    calls = 0

    def blocked(batch) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            entered.set()
            release.wait(timeout=3)
        original(batch)

    subject.log._write_batch = blocked
    first_flush = asyncio.create_task(subject.flush())
    assert await asyncio.to_thread(entered.wait, 2)
    subject.record(MomentKind.REPLY, {"text": "第二条"})
    second_flush = asyncio.create_task(subject.flush())
    await asyncio.sleep(0.05)
    assert calls == 1
    release.set()
    await asyncio.gather(first_flush, second_flush)
    await subject.stop()
    assert [item.seq for item in subject.log.query()] == [1, 2]


async def test_failed_stop_keeps_single_writer_until_retry_succeeds(tmp_path: Path) -> None:
    base_dir = tmp_path / "log"
    subject = recorder(base_dir)
    competitor = recorder(base_dir)
    await subject.start()
    subject.record(MomentKind.PERCEPTION, {"text": "必须保留"})
    original = subject.log._write_pack

    def fail_pack(_pack, _batch) -> None:
        raise OSError("injected pack failure")

    subject.log._write_pack = fail_pack
    with pytest.raises(OSError, match="pack failure"):
        await subject.stop()
    with pytest.raises(RuntimeError, match="已有写入者"):
        await competitor.start()

    subject.log._write_pack = original
    await subject.stop()
    await competitor.start()
    second = competitor.record(MomentKind.REPLY, {"text": "接续"})
    await competitor.stop()
    assert second is not None and second.seq == 2
    assert [item.seq for item in competitor.log.query()] == [1, 2]
