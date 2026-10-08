"""Conversation Log durability 与 History 重建的集成反例。"""

from __future__ import annotations

import asyncio
import hashlib
import json
import sqlite3
import threading
import uuid
from dataclasses import asdict, replace
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from glimmer_cradle.conversation import (
    ConversationController,
    ConversationStore,
    ConversationTurn,
    ExecutionResultFact,
    MomentKind,
    NotificationReplyFact,
    SourceDescriptor,
    SqliteTurnStore,
    TurnConflictError,
    TurnController,
    build_conversation_recorder,
)


def test_frozen_log_fixtures_preserve_version_and_position_contract() -> None:
    fixtures = Path(__file__).parent / "fixtures"
    legacy_v4 = json.loads((fixtures / "legacy-log-v4.json").read_text(encoding="utf-8"))
    legacy_v5 = json.loads((fixtures / "legacy-log-v5.json").read_text(encoding="utf-8"))
    events = json.loads((fixtures / "conversation-events.json").read_text(encoding="utf-8"))

    assert (legacy_v4["schema_version"], legacy_v5["schema_version"]) == (4, 5)
    assert legacy_v4["position"] < legacy_v5["position"]
    assert [event["position"] for event in events] == [1, 2]
    assert events[1]["causation_ids"] == [events[0]["moment_id"]]


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


def execution_fact(source):
    return ExecutionResultFact(
        event_id=hashlib.sha256(b'["invoke:1",4]').hexdigest(), invocation_id="invoke:1",
        revision=4, attempt=1, scope_id=source.conversation_id, conversation_id=source.conversation_id,
        source_fact_id=source.moment_id, executor_id="browser", capability_id="open",
        definition_revision="actual", request_digest="a" * 64, state="succeeded", side_effects="confirmed",
        result={"text": "实际结果"}, error_code="", updated_at_ms=1,
    )


def notification_source(owner, *, scope="actor_private", actor="actor:one", privacy="sensitive"):
    return owner.record(MomentKind.PERCEPTION, {"text": "原始目标输入", "source_provider_id": "surface:one"},
        scene_id="scene:one", conversation_id="conversation:one", continuity_id="continuity:one", thread_id="thread:one",
        interaction_id="original:interaction", actor_id=actor, actor_name="原始角色", recall_scope=scope,
        disclosure_scope=scope, origin=SourceDescriptor(privacy_class=privacy))


def notification_fact(source):
    return NotificationReplyFact("a" * 64, "planning", source.conversation_id, source.moment_id,
        hashlib.sha256(json.dumps(asdict(source), ensure_ascii=False, sort_keys=True,
            separators=(",", ":"), allow_nan=False).encode()).hexdigest(),
        "b" * 64, "根据真实评估形成的通知", 1)


@pytest.mark.asyncio
@pytest.mark.parametrize("fault", ["actor", "scope", "privacy", "provider", "retention", "context"])
async def test_notification_incomplete_actual_source_never_forms_reply_or_turn(tmp_path, fault):
    owner = recorder(tmp_path / "log")
    turns = TurnController(SqliteTurnStore(tmp_path / "turns.db"), clock=Clock())
    await owner.start()
    await turns.connect()
    try:
        source = notification_source(owner, actor=None if fault == "actor" else "actor:one",
            scope="unknown_scope" if fault == "scope" else "actor_private", privacy="unknown" if fault == "privacy" else "private")
        if fault in {"provider", "retention", "context"}:
            source = owner.log.append(replace(source, seq=0, moment_id="malformed:source",
                **({"content": {"source_provider_id": True}} if fault == "provider" else
                   {"retention_ceiling": "transient"} if fault == "retention" else {"interaction_id": ""})))
        await owner.flush()
        before = owner.log.query()
        with pytest.raises(ValueError):
            await turns.accept_notification_reply(notification_fact(source), recorder=owner)
        assert owner.log.query() == before
        with sqlite3.connect(tmp_path / "turns.db") as db:
            assert db.execute("SELECT count(*) FROM conversation_turns").fetchone()[0] == 0
    finally:
        await turns.close()
        await owner.stop()


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["accepted", "completed", "interrupted", "failed"])
async def test_notification_cannot_graft_reply_onto_preexisting_ordinary_turn(tmp_path, status):
    owner = recorder(tmp_path / "log")
    turns = TurnController(SqliteTurnStore(tmp_path / "turns.db"), clock=Clock())
    await owner.start()
    await turns.connect()
    try:
        source = notification_source(owner)
        fact = notification_fact(source)
        turn_id = hashlib.sha256(f"conversation-notification-turn.v1:{fact.notification_id}".encode()).hexdigest()
        turn = await turns.accept(ConversationTurn(turn_id=turn_id, scene_id=source.scene_id,
            conversation_id=source.conversation_id, continuity_id=source.continuity_id,
            thread_id=source.thread_id, payload_digest=fact.input_digest))
        if status == "completed": turn = await turns.complete(turn_id, expected_revision=turn.revision)
        elif status == "interrupted": turn = await turns.interrupt(turn_id, expected_revision=turn.revision, reason="original cancelled")
        elif status == "failed": turn = await turns.fail(turn_id, expected_revision=turn.revision, reason="original failed")
        await owner.flush()
        before = owner.log.query()
        with pytest.raises(TurnConflictError):
            await turns.accept_notification_reply(fact, recorder=owner)
        assert await turns.load(turn_id) == turn
        assert owner.log.query() == before
    finally:
        await turns.close()
        await owner.stop()


@pytest.mark.asyncio
@pytest.mark.parametrize("scope", ["public", "conversation_private", "actor_private", "space_local", "character_internal"])
async def test_notification_reply_turn_and_full_privacy_survive_restart(tmp_path, scope):
    owner = recorder(tmp_path / "log")
    turns = TurnController(SqliteTurnStore(tmp_path / "turns.db"), clock=Clock())
    await owner.start()
    await turns.connect()
    try:
        source = notification_source(owner, scope=scope)
        fact = notification_fact(source)
        turn, reply = await turns.accept_notification_reply(fact, recorder=owner)
        assert turn.status == "completed" and turn.revision == 2 and turn.payload_digest == fact.input_digest
        assert reply.kind == "reply" and reply.causation_ids == (source.moment_id,)
        assert (reply.scene_id, reply.conversation_id, reply.continuity_id, reply.thread_id) == (
            source.scene_id, source.conversation_id, source.continuity_id, source.thread_id)
        assert reply.interaction_id == turn.turn_id != source.interaction_id
        assert (reply.actor_id, reply.actor_name, reply.recall_scope, reply.disclosure_scope) == (
            source.actor_id, source.actor_name, scope, scope)
        assert reply.origin.privacy_class == "sensitive" and reply.retention_ceiling == "experience"
        assert reply.content["text"] == fact.text and reply.content["source_provider_id"] == "surface:one"
        assert reply.content["notification"]["input_digest"] == fact.input_digest
        await owner.stop()
        await turns.close()
        owner = recorder(tmp_path / "log")
        turns = TurnController(SqliteTurnStore(tmp_path / "turns.db"), clock=Clock())
        await owner.start()
        assert await turns.connect() == 0
        assert await turns.accept_notification_reply(fact, recorder=owner) == (turn, reply)
        assert len(owner.log.query()) == 2
        with sqlite3.connect(tmp_path / "turns.db") as db:
            assert db.execute("SELECT count(*) FROM conversation_turns").fetchone()[0] == 1
    finally:
        await turns.close()
        await owner.stop()


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["text", "input_digest", "producer_id", "source_fact_id", "scope_id"])
async def test_notification_same_identity_changed_facts_never_overwrite_reply_or_turn(tmp_path, change):
    owner = recorder(tmp_path / "log")
    turns = TurnController(SqliteTurnStore(tmp_path / "turns.db"), clock=Clock())
    await owner.start()
    await turns.connect()
    try:
        fact = notification_fact(notification_source(owner))
        accepted = await turns.accept_notification_reply(fact, recorder=owner)
        before = owner.log.query()
        value = "c" * 64 if change == "input_digest" else "changed"
        with pytest.raises((ValueError, RuntimeError)):
            await turns.accept_notification_reply(replace(fact, **{change: value}), recorder=owner)
        assert owner.log.query() == before
        assert await turns.load(accepted[0].turn_id) == accepted[0]
    finally:
        await turns.close()
        await owner.stop()


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [
    {"notification_id": "wrong"}, {"source_digest": "wrong"}, {"input_digest": "wrong"},
    {"text": " "}, {"text": "x" * 16385}, {"producer_id": " "}, {"scope_id": True},
    {"created_at_ms": True}, {"created_at_ms": -1}, {"created_at_ms": 253402300800000},
])
async def test_invalid_notification_rejected_before_reply_or_turn_write(tmp_path, change):
    owner = recorder(tmp_path / "log")
    turns = TurnController(SqliteTurnStore(tmp_path / "turns.db"), clock=Clock())
    await owner.start()
    await turns.connect()
    try:
        fact = notification_fact(notification_source(owner))
        await owner.flush()
        before = owner.log.query()
        with pytest.raises(ValueError):
            await turns.accept_notification_reply(replace(fact, **change), recorder=owner)
        assert owner.log.query() == before
        with sqlite3.connect(tmp_path / "turns.db") as db:
            assert db.execute("SELECT count(*) FROM conversation_turns").fetchone()[0] == 0
    finally:
        await turns.close()
        await owner.stop()


@pytest.mark.asyncio
async def test_notification_flush_failure_keeps_turn_unconfirmed_and_exact_retry_recovers(tmp_path):
    owner = recorder(tmp_path / "log")
    turns = TurnController(SqliteTurnStore(tmp_path / "turns.db"), clock=Clock())
    await owner.start()
    await turns.connect()
    original = owner.log._write_batch
    try:
        fact = notification_fact(notification_source(owner))
        await owner.flush()
        owner.log._write_batch = lambda _batch: (_ for _ in ()).throw(RuntimeError("fixture flush failure"))
        with pytest.raises(RuntimeError, match="fixture flush failure"):
            await turns.accept_notification_reply(fact, recorder=owner)
        with sqlite3.connect(tmp_path / "turns.db") as db:
            assert db.execute("SELECT count(*) FROM conversation_turns").fetchone()[0] == 0
        owner.log._write_batch = original
        turn, reply = await turns.accept_notification_reply(fact, recorder=owner)
        assert turn.status == "completed" and reply.seq == 2
        assert len(owner.log.query()) == 2
    finally:
        owner.log._write_batch = original
        await turns.close()
        await owner.stop()


@pytest.mark.asyncio
async def test_notification_reply_committed_turn_insert_failed_reopens_without_second_reply(tmp_path):
    owner = recorder(tmp_path / "log")
    turns = TurnController(SqliteTurnStore(tmp_path / "turns.db"), clock=Clock())
    await owner.start()
    await turns.connect()
    try:
        fact = notification_fact(notification_source(owner))
        with sqlite3.connect(tmp_path / "turns.db") as db:
            db.execute("CREATE TRIGGER fixture_failure BEFORE INSERT ON conversation_turns BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
        with pytest.raises(RuntimeError, match="Turn identity"):
            await turns.accept_notification_reply(fact, recorder=owner)
        reply = owner.recorded_fact(f"notification-reply:{fact.notification_id}")
        assert reply is not None and await turns.load(reply.interaction_id) is None
        await owner.stop()
        await turns.close()
        with sqlite3.connect(tmp_path / "turns.db") as db:
            db.execute("DROP TRIGGER fixture_failure")
        owner = recorder(tmp_path / "log")
        turns = TurnController(SqliteTurnStore(tmp_path / "turns.db"), clock=Clock())
        await owner.start()
        await turns.connect()
        restored, replay = await turns.accept_notification_reply(fact, recorder=owner)
        assert replay == reply and restored.status == "completed" and len(owner.log.query()) == 2
    finally:
        await turns.close()
        await owner.stop()


@pytest.mark.asyncio
async def test_execution_receipt_reopen_identity_and_scope(tmp_path):
    owner = recorder(tmp_path)
    await owner.start()
    try:
        source = owner.record(MomentKind.ACTION, {"action_type": "skill_request"},
            conversation_id="private", scene_id="device", thread_id="thread:1",
            actor_id="actor", recall_scope="actor_private", disclosure_scope="actor_private")
        fact = execution_fact(source)
        accepted = await owner.accept_execution_result(fact)
        assert accepted.causation_ids == (source.moment_id,)
        assert (accepted.thread_id, accepted.actor_id, accepted.recall_scope) == ("thread:1", "actor", "actor_private")
        assert accepted.origin.trust_tier == "untrusted" and accepted.retention_ceiling == "experience"
        await owner.stop()
        owner = recorder(tmp_path)
        await owner.start()
        assert await owner.accept_execution_result(fact) == accepted
        assert len(owner.log.query()) == 2
        with pytest.raises(RuntimeError, match="冲突"):
            await owner.accept_execution_result(replace(fact, result="changed"))
        for change in ({"source_fact_id": "missing"}, {"scope_id": "other", "conversation_id": "other"}):
            with pytest.raises(RuntimeError):
                await owner.accept_execution_result(replace(fact, **change))
        for change in ({"event_id": "wrong"}, {"revision": True}, {"attempt": 1.0},
                       {"state": "unknown"}, {"updated_at_ms": 9007199254740991},
                       {"result": float("nan")}, {"side_effects": "unknown"}):
            with pytest.raises(ValueError):
                await owner.accept_execution_result(replace(fact, **change))
    finally:
        await owner.stop()


@pytest.mark.asyncio
async def test_execution_receipt_repeated_cancel_holds_real_commit_barrier(tmp_path, monkeypatch):
    owner = recorder(tmp_path)
    await owner.start()
    entered, release = threading.Event(), threading.Event()
    original = owner.log._write_batch
    tasks = []
    try:
        source = owner.record(MomentKind.ACTION, {}, conversation_id="private")
        await owner.flush()
        def blocked(batch):
            entered.set()
            assert release.wait(5)
            original(batch)
        monkeypatch.setattr(owner.log, "_write_batch", blocked)
        fact = execution_fact(source)
        first = asyncio.create_task(owner.accept_execution_result(fact)); tasks.append(first)
        assert await asyncio.to_thread(entered.wait, 2)
        first.cancel(); await asyncio.sleep(0); first.cancel(); await asyncio.sleep(0)
        second = asyncio.create_task(owner.accept_execution_result(fact)); tasks.append(second)
        await asyncio.sleep(0.02)
        assert not first.done() and not second.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await first
        accepted = await second
        assert accepted.seq == 2 and len(owner.log.query()) == 2
        await owner.stop(); owner = recorder(tmp_path); await owner.start()
        assert await owner.accept_execution_result(fact) == accepted
    finally:
        release.set()
        await asyncio.gather(*tasks, return_exceptions=True)
        await owner.stop()


@pytest.mark.asyncio
async def test_execution_receipt_failed_flush_returns_no_receipt_then_retries(tmp_path, monkeypatch):
    owner = recorder(tmp_path); await owner.start()
    try:
        source = owner.record(MomentKind.ACTION, {}, conversation_id="private")
        await owner.flush()
        original = owner.log._write_batch
        def fail(_batch):
            raise OSError("fixture disk failure")
        monkeypatch.setattr(owner.log, "_write_batch", fail)
        fact = execution_fact(source)
        with pytest.raises(OSError):
            await owner.accept_execution_result(fact)
        monkeypatch.setattr(owner.log, "_write_batch", original)
        accepted = await owner.accept_execution_result(fact)
        assert accepted.seq == 2
        await owner.stop(); owner = recorder(tmp_path); await owner.start()
        assert await owner.accept_execution_result(fact) == accepted
    finally:
        await owner.stop()


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


_V3_HISTORY_DDL = """
CREATE TABLE schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE projection_meta(name TEXT PRIMARY KEY,position INTEGER NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE conversation_threads(
  conversation_id TEXT PRIMARY KEY, continuity_id TEXT NOT NULL, scene_id TEXT NOT NULL,
  thread_id TEXT NOT NULL, recall_scope TEXT NOT NULL, disclosure_scope TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE conversation_messages(
  position INTEGER PRIMARY KEY, moment_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL REFERENCES conversation_threads(conversation_id),
  chapter_id TEXT, scene_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  interaction_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL, actor_id TEXT, actor_name TEXT, occurred_at TEXT NOT NULL,
  importance REAL NOT NULL, recall_scope TEXT NOT NULL, disclosure_scope TEXT NOT NULL
);
CREATE INDEX idx_conversation_messages_thread ON conversation_messages(conversation_id,position DESC);
CREATE TABLE conversation_chapters(
  chapter_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
  sequence INTEGER NOT NULL, status TEXT NOT NULL,
  first_position INTEGER NOT NULL, last_position INTEGER NOT NULL,
  started_at TEXT NOT NULL, ended_at TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
  UNIQUE(conversation_id,sequence)
);
CREATE INDEX idx_conversation_chapters_active ON conversation_chapters(conversation_id,status,last_position);
CREATE TABLE conversation_segments(
  segment_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
  level INTEGER NOT NULL, parent_segment_id TEXT,
  first_position INTEGER NOT NULL, last_position INTEGER NOT NULL,
  summary TEXT NOT NULL, keywords_json TEXT NOT NULL, actor_ids_json TEXT NOT NULL,
  recall_scope TEXT NOT NULL, disclosure_scope TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(conversation_id,level,first_position,last_position)
);
CREATE INDEX idx_conversation_segments_lookup ON conversation_segments(conversation_id,level,last_position DESC);
CREATE TABLE conversation_segment_members(
  segment_id TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(segment_id,position)
);
CREATE TABLE conversation_state(
  conversation_id TEXT PRIMARY KEY,version INTEGER NOT NULL,through_position INTEGER NOT NULL,
  state_json TEXT NOT NULL,updated_at TEXT NOT NULL
);
"""


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


async def test_idempotent_fact_replay_keeps_original_position_and_rejects_conflict(
    tmp_path: Path,
) -> None:
    base_dir = tmp_path / "log"
    subject = recorder(base_dir)
    await subject.start()
    first = subject.record(
        MomentKind.ACTION,
        {"action_type": "tool_call", "invocation_id": "invoke-1"},
        idempotency_key="tool-call:invoke-1",
    )
    await subject.flush()
    replay = subject.record(
        MomentKind.ACTION,
        {"action_type": "tool_call", "invocation_id": "invoke-1"},
        idempotency_key="tool-call:invoke-1",
    )
    assert replay is not None and first is not None
    assert replay.moment_id == first.moment_id
    assert replay.seq == first.seq == 1
    assert len(subject.log.query()) == 1

    with pytest.raises(RuntimeError, match="幂等 fact 冲突"):
        subject.record(
            MomentKind.ACTION,
            {"action_type": "tool_call", "invocation_id": "changed"},
            idempotency_key="tool-call:invoke-1",
        )
    await subject.stop()


async def test_history_v3_migrates_losslessly_to_thread_scoped_v4(
    tmp_path: Path,
) -> None:
    database = tmp_path / "history.db"
    timestamp = "2026-01-01T00:00:00Z"
    with sqlite3.connect(database) as connection:
        connection.executescript(_V3_HISTORY_DDL)
        connection.execute("INSERT INTO schema_meta VALUES('schema_version','3')")
        connection.execute(
            "INSERT INTO projection_meta VALUES('conversation',2,?)",
            (timestamp,),
        )
        connection.execute(
            "INSERT INTO conversation_threads VALUES(?,?,?,?,?,?,?,?)",
            (
                "conversation:migrate",
                "continuity:legacy",
                "scene:legacy",
                "main",
                "conversation_private",
                "conversation_private",
                timestamp,
                timestamp,
            ),
        )
        connection.executemany(
            "INSERT INTO conversation_messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                (
                    1,
                    "moment:user",
                    "conversation:migrate",
                    "chapter:legacy",
                    "scene:legacy",
                    "main",
                    "interaction:legacy",
                    "user",
                    "迁移前的问题",
                    None,
                    None,
                    timestamp,
                    0.6,
                    "conversation_private",
                    "conversation_private",
                ),
                (
                    2,
                    "moment:assistant",
                    "conversation:migrate",
                    "chapter:legacy",
                    "scene:legacy",
                    "main",
                    "interaction:legacy",
                    "assistant",
                    "迁移前的回答",
                    "selrena",
                    "月见",
                    timestamp,
                    0.5,
                    "conversation_private",
                    "conversation_private",
                ),
            ),
        )
        connection.execute(
            "INSERT INTO conversation_chapters VALUES(?,?,?,?,?,?,?,?,?)",
            (
                "chapter:legacy",
                "conversation:migrate",
                1,
                "active",
                1,
                2,
                timestamp,
                timestamp,
                "迁移前的章节摘要",
            ),
        )
        connection.execute(
            "INSERT INTO conversation_segments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "segment:legacy",
                "conversation:migrate",
                "chapter:legacy",
                0,
                None,
                1,
                2,
                "迁移前的问题与回答",
                '["迁移", "回答"]',
                '["selrena"]',
                "conversation_private",
                "conversation_private",
                timestamp,
            ),
        )
        connection.executemany(
            "INSERT INTO conversation_segment_members VALUES(?,?)",
            (("segment:legacy", 1), ("segment:legacy", 2)),
        )
        connection.execute(
            "INSERT INTO conversation_state VALUES(?,?,?,?,?)",
            (
                "conversation:migrate",
                2,
                2,
                '{"active_topic":"迁移前的问题",'
                '"_recall_scope":"conversation_private",'
                '"_disclosure_scope":"conversation_private"}',
                timestamp,
            ),
        )
        connection.commit()

    store = ConversationStore(database, config=projection_config())
    await store.connect()
    assert await store.checkpoint() == 2
    state, messages = await store.load_working_set(
        "conversation:migrate", "main", limit=8
    )
    segments = await store.retrieve_segments(
        "conversation:migrate",
        "main",
        "迁移回答",
        allowed_scopes={"conversation_private"},
        limit=4,
    )
    await store.close()

    assert state["active_topic"] == "迁移前的问题"
    assert [message.content for message in messages] == ["迁移前的问题", "迁移前的回答"]
    assert segments == ["迁移前的问题与回答"]
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT value FROM schema_meta WHERE key='schema_version'"
        ).fetchone() == ("4",)
        assert connection.execute(
            "SELECT thread_id FROM conversation_chapters"
        ).fetchone() == ("main",)
        assert connection.execute(
            "SELECT thread_id FROM conversation_segments"
        ).fetchone() == ("main",)
        assert connection.execute(
            "SELECT thread_id FROM conversation_state"
        ).fetchone() == ("main",)
        assert connection.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'v3_%'"
        ).fetchone() == (0,)


async def test_history_isolates_multiple_threads_in_one_conversation(
    tmp_path: Path,
) -> None:
    log = recorder(tmp_path / "log")
    await log.start()
    for thread_id, continuity_id, user_text, reply_text in (
        ("main", "continuity:main", "主线程问题", "主线程回答"),
        ("topic:audio", "continuity:audio", "音频线程问题", "音频线程回答"),
    ):
        common = {
            "scene_id": "scene:shared",
            "conversation_id": "conversation:shared",
            "continuity_id": continuity_id,
            "thread_id": thread_id,
            "interaction_id": f"interaction:{thread_id}",
        }
        log.record(MomentKind.PERCEPTION, {"text": user_text}, **common)
        log.record(MomentKind.REPLY, {"text": reply_text}, **common)

    controller = ConversationController(
        store=ConversationStore(tmp_path / "history.db", config=projection_config()),
        recorder=log,
        working_config=working_config(),
    )
    await controller.connect()
    _, main_recent, main_history = await controller.prompt_context(
        "conversation:shared",
        "main",
        "主线程",
        allowed_scopes={"conversation_private"},
    )
    _, audio_recent, audio_history = await controller.prompt_context(
        "conversation:shared",
        "topic:audio",
        "音频线程",
        allowed_scopes={"conversation_private"},
    )
    await controller.close()
    await log.stop()

    assert "主线程问题" in main_recent and "主线程回答" in main_recent
    assert "音频线程" not in main_recent
    assert "音频线程问题" in audio_recent and "音频线程回答" in audio_recent
    assert "主线程" not in audio_recent
    assert "主线程" in main_history and "音频线程" not in main_history
    assert "音频线程" in audio_history and "主线程" not in audio_history
