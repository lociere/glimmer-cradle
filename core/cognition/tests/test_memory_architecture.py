import asyncio
import json
import sqlite3
from dataclasses import replace
from pathlib import Path

import pytest
from glimmer_cradle.cognition.adapters.persistence import (
    ConsolidationJobRepository,
    EpisodeProjection,
    MemoryRepository,
    RelationshipProjection,
    RelationshipRepository,
    SqliteMemoryStore,
    VectorRepository,
)
from glimmer_cradle.cognition.memory import (
    ConsolidationCoordinator as _ConsolidationCoordinator,
)
from glimmer_cradle.cognition.memory import (
    MaintenanceScheduler as _MaintenanceScheduler,
)
from glimmer_cradle.cognition.memory import (
    MemoryConsolidationConflictError,
    MemoryConsolidationInput,
    MemoryKind,
)
from glimmer_cradle.cognition.memory import MemoryController as _MemoryController
from glimmer_cradle.conversation.log import Moment, MomentKind
from tests.conftest import (
    CLOCK,
    IDS,
    OBSERVABILITY,
    build_experience_recorder,
)
from tests.conftest import (
    TestClock as _TestClock,
)


def MemoryController(*args, **kwargs):
    kwargs.setdefault("clock", CLOCK)
    return _MemoryController(*args, **kwargs)


def ConsolidationCoordinator(*args, **kwargs):
    kwargs.setdefault("ids", IDS)
    kwargs.setdefault("observability", OBSERVABILITY)
    return _ConsolidationCoordinator(*args, **kwargs)


def MaintenanceScheduler(*args, **kwargs):
    kwargs.setdefault("observability", OBSERVABILITY)
    return _MaintenanceScheduler(*args, **kwargs)


@pytest.fixture
async def memory_stack(tmp_path: Path):
    database = SqliteMemoryStore(tmp_path / "memory.sqlite")
    await database.connect()
    repository = MemoryRepository(database)
    memory = MemoryController(token_budget=128, result_limit=3)
    memory.bind_repository(repository)
    await memory.load()
    yield database, repository, memory
    await database.close()


async def test_memory_requires_evidence_and_keeps_revision_history(memory_stack) -> None:
    database, repository, memory = memory_stack
    with pytest.raises(ValueError):
        await memory.remember(kind=MemoryKind.SEMANTIC, content="月见喜欢雨天",
                              evidence=[], consolidation_id="run-empty")
    memory_id = await memory.remember(
        kind=MemoryKind.SEMANTIC, content="用户喜欢雨天", summary="用户偏好雨天",
        actor_id="user:1", evidence=[{"moment_id": "m1", "source": {"provider_kind": "user"}}],
        consolidation_id="run-1", attributes={"preference": True})
    await memory.remember(
        memory_id=memory_id, kind=MemoryKind.SEMANTIC, content="用户现在更喜欢晴天",
        summary="用户偏好晴天", actor_id="user:1",
        evidence=[{"moment_id": "m2", "source": {"provider_kind": "user"}}],
        consolidation_id="run-2", attributes={"preference": True})

    cursor = await database.connection.execute(
        "SELECT valid_to FROM memory_revisions WHERE memory_id=? ORDER BY created_at", (memory_id,))
    rows = await cursor.fetchall()
    assert len(rows) == 2 and rows[0][0] is not None and rows[1][0] is None
    assert (await memory.retrieve("晴天", actor_id="user:1"))[0].content == "用户现在更喜欢晴天"


async def test_memory_batch_is_atomic_and_retry_idempotent(memory_stack) -> None:
    database, _, memory = memory_stack
    valid = {
        "memory_id": "stable-memory",
        "kind": MemoryKind.SEMANTIC,
        "content": "可验证事实",
        "summary": "可验证",
        "evidence": [{"moment_id": "m1", "source": {"provider_kind": "user"}}],
        "consolidation_id": "batch-1",
    }
    with pytest.raises(ValueError):
        await memory.remember_batch([valid, {
            "kind": MemoryKind.SEMANTIC,
            "content": "无证据事实",
            "evidence": [],
            "consolidation_id": "batch-1",
        }])
    cursor = await database.connection.execute("SELECT COUNT(*) FROM memory_items")
    assert (await cursor.fetchone())[0] == 0

    assert await memory.remember_batch([valid]) == ["stable-memory"]
    assert await memory.remember_batch([valid]) == ["stable-memory"]
    cursor = await database.connection.execute(
        "SELECT COUNT(*) FROM memory_revisions WHERE memory_id='stable-memory'")
    assert (await cursor.fetchone())[0] == 1


def _receipt_draft(operation_id="receipt-op", memory_id="receipt-memory"):
    return {"memory_id": memory_id, "kind": MemoryKind.SEMANTIC,
            "content": "持久且可验证的事实", "evidence": [{"moment_id": "receipt-evidence"}],
            "consolidation_id": operation_id, "attributes": {"a": 1, "b": 2}}


def _receipt_input(episode_id="receipt-episode"):
    return MemoryConsolidationInput(episode_id, 1, "scope:private", "a" * 64)


async def test_receipt_reopens_original_result_and_canonical_retry(memory_stack):
    database, repository, memory = memory_stack
    inputs = (_receipt_input("second"), _receipt_input("first"))
    receipt = await memory.commit_consolidation("receipt-op", inputs, [_receipt_draft()])
    assert not receipt.duplicate and receipt.memory_ids == ("receipt-memory",)
    await database.close()
    await database.connect()
    recovered = await memory.find_consolidation(inputs[0])
    assert recovered == replace(receipt, duplicate=True)
    draft = {**_receipt_draft(), "attributes": {"b": 2, "a": 1}}
    assert await memory.commit_consolidation("receipt-op", tuple(reversed(inputs)), [draft]) == recovered
    assert await repository.count() == 1
    async with database.read() as conn:
        assert (await (await conn.execute("SELECT COUNT(*) FROM memory_revisions")).fetchone())[0] == 1
        assert (await (await conn.execute("SELECT COUNT(*) FROM memory_evidence")).fetchone())[0] == 1
        row = await (await conn.execute("SELECT * FROM memory_consolidation_receipts")).fetchone()
        assert _receipt_draft()["content"] not in str(row)


@pytest.mark.parametrize("table", ["memory_evidence", "memory_consolidation_receipts", "memory_consolidation_inputs"])
async def test_receipt_fault_rolls_back_business_evidence_and_all_inputs(memory_stack, table):
    database, _, memory = memory_stack
    async with database.transaction() as conn:
        condition = "WHEN NEW.episode_id='second' " if table == "memory_consolidation_inputs" else ""
        await conn.execute(f"CREATE TRIGGER receipt_fault BEFORE INSERT ON {table} {condition}BEGIN SELECT RAISE(ABORT,'receipt fault'); END")
    with pytest.raises(sqlite3.IntegrityError, match="receipt fault"):
        await memory.commit_consolidation("receipt-op", (_receipt_input(), _receipt_input("second")), [_receipt_draft()])
    async with database.read() as conn:
        for target in ("memory_items", "memory_revisions", "memory_evidence", "memory_consolidation_receipts", "memory_consolidation_inputs"):
            assert (await (await conn.execute(f"SELECT COUNT(*) FROM {target}")).fetchone())[0] == 0
    assert await memory.find_consolidation(_receipt_input()) is None


async def test_receipt_noop_is_durable_and_conflicting_identity_is_rejected(memory_stack):
    _, _, memory = memory_stack
    item = _receipt_input()
    receipt = await memory.commit_consolidation("receipt-op", (item,), [])
    assert receipt.memory_ids == ()
    assert await memory.find_consolidation(item) == replace(receipt, duplicate=True)
    for candidate in (replace(item, scope_id="other"), replace(item, input_digest="b" * 64)):
        with pytest.raises(MemoryConsolidationConflictError, match="scope/digest"):
            await memory.find_consolidation(candidate)
        with pytest.raises(MemoryConsolidationConflictError):
            await memory.commit_consolidation("receipt-op", (candidate,), [])
    assert await memory.find_consolidation(replace(item, episode_version=2)) is None
    with pytest.raises(MemoryConsolidationConflictError, match="其他 operation"):
        await memory.commit_consolidation("other-op", (item,), [])
    with pytest.raises(MemoryConsolidationConflictError, match="内容冲突"):
        await memory.commit_consolidation("receipt-op", (item,), [_receipt_draft()])


@pytest.mark.parametrize("change", [{"episode_id": " "}, {"scope_id": ""}, {"episode_version": True},
                                   {"episode_version": 0}, {"input_digest": "A" * 64}, {"input_digest": "short"}])
async def test_receipt_rejects_invalid_input_before_writing(memory_stack, change):
    _, repository, memory = memory_stack
    item = replace(_receipt_input(), **change)
    with pytest.raises(MemoryConsolidationConflictError):
        await memory.commit_consolidation("receipt-op", (item,), [_receipt_draft()])
    with pytest.raises(MemoryConsolidationConflictError):
        await memory.find_consolidation(item)
    assert await repository.count() == 0


async def test_receipt_rejects_duplicate_drafts_and_unreceipted_revision(memory_stack):
    _, repository, memory = memory_stack
    with pytest.raises(MemoryConsolidationConflictError, match="重复修订"):
        await memory.commit_consolidation("receipt-op", (_receipt_input(),),
                                          [_receipt_draft(), {**_receipt_draft(), "content": "different"}])
    await memory.remember_batch([_receipt_draft()])
    with pytest.raises(MemoryConsolidationConflictError, match="缺少原子 receipt"):
        await memory.commit_consolidation("receipt-op", (_receipt_input(),), [_receipt_draft()])
    assert await memory.find_consolidation(_receipt_input()) is None
    assert await repository.count() == 1


@pytest.mark.parametrize("after_commit", [False, True])
async def test_cancelled_receipt_confirmation_queries_actual_commit_not_assumed_failure(memory_stack, after_commit):
    database, repository, memory = memory_stack
    original_commit = database.connection.commit
    entered = asyncio.Event()

    async def interrupted_commit():
        if after_commit:
            await original_commit()
        entered.set()
        await asyncio.Event().wait()

    database.connection.commit = interrupted_commit
    pending = asyncio.create_task(memory.commit_consolidation("receipt-op", (_receipt_input(),), [_receipt_draft()]))
    try:
        await asyncio.wait_for(entered.wait(), 2)
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending
        database.connection.commit = original_commit
        await database.close()
        await database.connect()
        receipt = await memory.find_consolidation(_receipt_input())
        assert (receipt is not None) is after_commit
        assert await repository.count() == int(after_commit)
        if receipt is not None:
            assert receipt.memory_ids == ("receipt-memory",)
    finally:
        pending.cancel()
        await asyncio.gather(pending, return_exceptions=True)


@pytest.mark.parametrize("case", ["empty_operation", "empty_input", "duplicate_input", "mixed_scope", "unstable_draft"])
async def test_receipt_rejects_ambiguous_batch_identity(memory_stack, case):
    _, repository, memory = memory_stack
    item = _receipt_input()
    operation, inputs, drafts = "receipt-op", (item,), [_receipt_draft()]
    if case == "empty_operation":
        operation = " "
    elif case == "empty_input":
        inputs = ()
    elif case == "duplicate_input":
        inputs = (item, item)
    elif case == "mixed_scope":
        inputs = (item, replace(item, episode_id="other", scope_id="other"))
    else:
        drafts = [{**_receipt_draft(), "memory_id": ""}]
    with pytest.raises(MemoryConsolidationConflictError):
        await memory.commit_consolidation(operation, inputs, drafts)
    assert await repository.count() == 0


@pytest.mark.parametrize("same_operation", [True, False])
async def test_two_real_connections_commit_only_one_episode_result(memory_stack, same_operation):
    database, _, memory = memory_stack
    other = SqliteMemoryStore(database._db_path)
    await other.connect()
    candidate = MemoryController()
    candidate.bind_repository(MemoryRepository(other))
    operation = "receipt-op" if same_operation else "competing-op"
    try:
        results = await asyncio.gather(
            memory.commit_consolidation("receipt-op", (_receipt_input(),), [_receipt_draft()]),
            candidate.commit_consolidation(operation, (_receipt_input(),), [_receipt_draft(operation)]),
            return_exceptions=True,
        )
        if same_operation:
            assert sorted(result.duplicate for result in results) == [False, True]
            assert results[0].receipt_id == results[1].receipt_id
        else:
            assert sum(isinstance(result, MemoryConsolidationConflictError) for result in results) == 1
        async with database.read() as conn:
            assert (await (await conn.execute("SELECT COUNT(*) FROM memory_consolidation_receipts")).fetchone())[0] == 1
            assert (await (await conn.execute("SELECT COUNT(*) FROM memory_revisions")).fetchone())[0] == 1
    finally:
        await other.close()


async def test_memory_v3_rejected_without_upgrading_or_losing_existing_data(memory_stack):
    database, _, memory = memory_stack
    await memory.remember_batch([_receipt_draft()])
    async with database.transaction() as conn:
        await conn.execute("DROP TABLE memory_consolidation_inputs")
        await conn.execute("DROP TABLE memory_consolidation_receipts")
        await conn.execute("UPDATE schema_meta SET value='3' WHERE key='schema_version'")
    await database.close()
    with pytest.raises(RuntimeError, match="受控数据迁移"):
        await database.connect()
    assert database._conn is None
    with sqlite3.connect(database._db_path) as observer:
        assert observer.execute("SELECT value FROM schema_meta").fetchone() == ("3",)
        assert observer.execute("SELECT COUNT(*) FROM memory_revisions").fetchone() == (1,)


async def test_shared_vector_writer_cannot_commit_an_unfinished_memory_batch(memory_stack) -> None:
    import sqlite3

    import numpy as np

    database, repository, memory = memory_stack
    entered, release = asyncio.Event(), asyncio.Event()
    original = repository._create_revision

    async def delayed(conn, draft):
        if draft["memory_id"] == "first":
            result = await original(conn, draft)
            entered.set()
            await release.wait()
            return result
        raise ValueError("injected second draft failure")

    repository._create_revision = delayed
    draft = {"kind": MemoryKind.SEMANTIC, "content": "must roll back",
             "evidence": [{"moment_id": "m1"}], "consolidation_id": "batch-concurrent"}
    pending = asyncio.create_task(memory.remember_batch([
        {**draft, "memory_id": "first"}, {**draft, "memory_id": "second"},
    ]))
    vector = None
    try:
        await asyncio.wait_for(entered.wait(), 2)
        vector = asyncio.create_task(VectorRepository(database).upsert_vector(
            owner_kind="memory", owner_id="independent", model="test", vector=np.array([1.0]),
        ))
        # 观察独立连接的实际可见性，而不是仅检查 Task 是否完成。
        await asyncio.sleep(0.03)
        with sqlite3.connect(database._db_path) as observer:
            assert observer.execute("SELECT COUNT(*) FROM memory_items").fetchone()[0] == 0
            assert observer.execute("SELECT COUNT(*) FROM embedding").fetchone()[0] == 0
        release.set()
        with pytest.raises(ValueError, match="second draft failure"):
            await pending
        await vector
        assert await repository.count() == 0
        assert await VectorRepository(database).count("memory") == 1
    finally:
        release.set()
        await asyncio.gather(pending, *([vector] if vector is not None else []), return_exceptions=True)


@pytest.mark.parametrize("phase", ["begin", "body", "commit_before", "commit_after"])
async def test_memory_transaction_cancellation_drains_and_readers_see_only_committed_state(memory_stack, phase) -> None:
    database, repository, memory = memory_stack
    conn = database.connection
    entered, release = asyncio.Event(), asyncio.Event()
    original_execute, original_commit = conn.execute, conn.commit
    original_revision = repository._create_revision

    async def execute(sql, *args, **kwargs):
        result = await original_execute(sql, *args, **kwargs)
        if phase == "begin" and sql == "BEGIN IMMEDIATE":
            entered.set()
            await release.wait()
        return result

    async def create_revision(connection, draft):
        result = await original_revision(connection, draft)
        if phase == "body":
            entered.set()
            await release.wait()
        return result

    async def commit():
        if phase == "commit_after":
            await original_commit()
        entered.set()
        await release.wait()
        if phase != "commit_after":
            await original_commit()

    conn.execute = execute
    repository._create_revision = create_revision
    if phase.startswith("commit"):
        conn.commit = commit
    draft = {"memory_id": "interrupted", "kind": MemoryKind.SEMANTIC,
             "content": "transaction lifecycle", "evidence": [{"moment_id": "m1"}],
             "consolidation_id": "interrupted-batch"}
    pending = asyncio.create_task(memory.remember_batch([draft]))
    reader = None
    try:
        await asyncio.wait_for(entered.wait(), 2)
        reader = asyncio.create_task(repository.all_current())
        await asyncio.sleep(0)
        assert not reader.done()
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending
        rows = await asyncio.wait_for(reader, 2)
        # 已提交但确认被取消不能假装没提交；未来 Jobs 必须查询同事务 receipt。
        expected = 1 if phase == "commit_after" else 0
        assert len(rows) == expected
        assert not conn.in_transaction
        conn.execute, conn.commit = original_execute, original_commit
        repository._create_revision = original_revision
        await memory.remember_batch([{**draft, "memory_id": "after", "consolidation_id": "after"}])
        assert await repository.count() == expected + 1
    finally:
        release.set()
        pending.cancel()
        await asyncio.gather(pending, *([reader] if reader is not None else []), return_exceptions=True)
        conn.execute, conn.commit = original_execute, original_commit
        repository._create_revision = original_revision


async def test_repeated_cancellation_does_not_release_owner_until_rollback_finishes(memory_stack) -> None:
    database, repository, memory = memory_stack
    entered, rollback_entered, release = asyncio.Event(), asyncio.Event(), asyncio.Event()
    original_revision = repository._create_revision
    original_rollback = database.connection.rollback

    async def interrupted(conn, draft):
        await original_revision(conn, draft)
        entered.set()
        await asyncio.Event().wait()

    async def rollback():
        rollback_entered.set()
        await release.wait()
        await original_rollback()

    repository._create_revision = interrupted
    database.connection.rollback = rollback
    pending = asyncio.create_task(memory.remember_batch([{
        "memory_id": "cancelled", "kind": MemoryKind.SEMANTIC, "content": "must roll back",
        "evidence": [{"moment_id": "m1"}], "consolidation_id": "cancelled",
    }]))
    reader = None
    try:
        await asyncio.wait_for(entered.wait(), 2)
        pending.cancel()
        await asyncio.wait_for(rollback_entered.wait(), 2)
        pending.cancel()
        reader = asyncio.create_task(repository.count())
        await asyncio.sleep(0)
        assert database._connection_lock.locked()
        assert not pending.done() and not reader.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await pending
        assert await asyncio.wait_for(reader, 2) == 0
        assert not database.connection.in_transaction
    finally:
        release.set()
        pending.cancel()
        await asyncio.gather(pending, *([reader] if reader is not None else []), return_exceptions=True)
        database.connection.rollback = original_rollback
        repository._create_revision = original_revision


async def test_independent_memory_connections_respect_sqlite_writer_lock_and_recover(memory_stack) -> None:
    database, repository, _ = memory_stack
    other = SqliteMemoryStore(database._db_path)
    await other.connect()
    await other.connection.execute("PRAGMA busy_timeout=10")
    try:
        async with database.transaction() as conn:
            await conn.execute("INSERT INTO projection_checkpoints VALUES('held',1,'now')")
            import sqlite3
            with pytest.raises(sqlite3.OperationalError, match="locked"):
                async with other.transaction() as candidate:
                    await candidate.execute("INSERT INTO projection_checkpoints VALUES('other',1,'now')")
            assert not other.connection.in_transaction
        async with other.transaction() as candidate:
            await candidate.execute("INSERT INTO projection_checkpoints VALUES('other',1,'now')")
        assert await repository.count() == 0
        async with database.read() as reader:
            cursor = await reader.execute("SELECT projection_name FROM projection_checkpoints ORDER BY projection_name")
            assert await cursor.fetchall() == [("held",), ("other",)]
    finally:
        await other.close()


async def test_memory_rollback_failure_revokes_connection_instead_of_exposing_partial_state(memory_stack) -> None:
    database, repository, _ = memory_stack
    original = database.connection.rollback

    async def failed_rollback():
        raise RuntimeError("injected rollback failure")

    database.connection.rollback = failed_rollback
    with pytest.raises(ExceptionGroup, match="清理失败") as failure:
        async with database.transaction() as conn:
            await conn.execute("INSERT INTO projection_checkpoints VALUES('not-committed',1,'now')")
            raise ValueError("business failure")
    assert len(failure.value.exceptions) == 2
    with pytest.raises(RuntimeError, match="尚未连接"):
        await repository.count()
    await database.connect()
    async with database.read() as conn:
        cursor = await conn.execute("SELECT projection_name FROM projection_checkpoints")
        assert await cursor.fetchall() == []
    assert database.connection.rollback != original


async def test_cancelled_memory_initialization_rolls_back_schema_and_releases_connection(tmp_path, monkeypatch) -> None:
    import sqlite3

    import aiosqlite

    entered, release = asyncio.Event(), asyncio.Event()
    original_connect = aiosqlite.connect
    opened = []

    def connect(*args, **kwargs):
        connection = original_connect(*args, **kwargs)
        original_script = connection.executescript

        async def interrupted_script(sql):
            result = await original_script(sql)
            entered.set()
            await release.wait()
            return result

        connection.executescript = interrupted_script
        opened.append(connection)
        return connection

    database = SqliteMemoryStore(tmp_path / "interrupted-init.sqlite")
    monkeypatch.setattr(aiosqlite, "connect", connect)
    pending = asyncio.create_task(database.connect())
    try:
        await asyncio.wait_for(entered.wait(), 2)
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending
        assert not opened[0]._running
        with sqlite3.connect(database._db_path) as observer:
            assert observer.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall() == []
        monkeypatch.setattr(aiosqlite, "connect", original_connect)
        await database.connect()
        assert await MemoryRepository(database).count() == 0
    finally:
        release.set()
        pending.cancel()
        await asyncio.gather(pending, return_exceptions=True)
        await database.close()


async def test_cancelled_close_waits_for_resource_release_then_preserves_cancellation(memory_stack) -> None:
    database, repository, _ = memory_stack
    entered, release = asyncio.Event(), asyncio.Event()
    conn = database.connection
    original_close = conn.close

    async def delayed_close():
        entered.set()
        await release.wait()
        await original_close()

    conn.close = delayed_close
    pending = asyncio.create_task(database.close())
    try:
        await asyncio.wait_for(entered.wait(), 2)
        pending.cancel()
        await asyncio.sleep(0)
        assert not pending.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await pending
        with pytest.raises(RuntimeError, match="尚未连接"):
            await repository.count()
        assert not conn._running
    finally:
        release.set()
        await asyncio.gather(pending, return_exceptions=True)


async def test_relationship_counters_are_deterministic_and_summary_has_evidence(memory_stack) -> None:
    database, _, _ = memory_stack
    relationships = RelationshipRepository(database)
    first = await relationships.observe(
        "user:1", kind="direct", evidence_moment_id="m1", display_name="小林")
    duplicate = await relationships.observe(
        "user:1", kind="direct", evidence_moment_id="m1", display_name="小林")
    second = await relationships.observe("user:1", kind="reply", evidence_moment_id="m2")
    assert duplicate.direct_interactions == 1
    assert second.direct_interactions == 1 and second.replies == 1
    assert second.familiarity > first.familiarity
    with pytest.raises(ValueError):
        await relationships.revise("user:1", summary="熟悉的人", attributes={}, confidence=0.8,
                                   evidence_moment_ids=[], consolidation_id="run")
    await relationships.revise("user:1", summary="愿意直接表达需求",
                               attributes={"communication": "direct"}, confidence=0.8,
                               evidence_moment_ids=["m1"], consolidation_id="run")
    current = await relationships.get("user:1")
    assert current.summary == "愿意直接表达需求"


async def test_relationship_projection_is_idempotent_from_ledger(tmp_path: Path) -> None:
    recorder = build_experience_recorder(tmp_path / "experience")
    await recorder.start()
    recorder.record(
        MomentKind.PERCEPTION,
        {"text": "你好", "address_mode": "direct"},
        interaction_id="turn-1",
        actor_id="user:1",
        actor_name="小林",
    )
    recorder.record(
        MomentKind.REPLY,
        {"text": "你好"},
        interaction_id="turn-1",
        actor_id="user:1",
        actor_name="小林",
    )
    database = SqliteMemoryStore(tmp_path / "memory.sqlite")
    await database.connect()
    relationships = RelationshipRepository(database)
    projection = RelationshipProjection(
        recorder=recorder, repository=relationships, database=database)

    assert await projection.project_pending() == 2
    assert await projection.project_pending() == 0
    record = await relationships.get("user:1")
    assert record is not None
    assert record.direct_interactions == 1 and record.replies == 1
    cursor = await database.connection.execute("SELECT COUNT(*) FROM relationship_observations")
    assert (await cursor.fetchone())[0] == 2
    await recorder.stop()
    await database.close()


class _ConsolidationLlm:
    def __init__(self, response: str) -> None:
        self.response = response
        self.requests = []

    async def generate(self, request) -> str:
        self.requests.append(request)
        return self.response


@pytest.fixture
async def consolidation_stack(tmp_path, memory_stack):
    database, repository, memory = memory_stack
    recorder = build_experience_recorder(tmp_path / "experience-receipt")
    await recorder.start()
    moments = [recorder.record(
        MomentKind.PERCEPTION, {"text": f"持久事实 {index}"}, scene_id="desktop",
        conversation_id="conversation:receipt", interaction_id=f"turn-{index}", actor_id="user:1",
        retention_ceiling="memory_candidate", importance=0.9,
    ) for index in range(2)]
    episodes = EpisodeProjection(tmp_path / "receipt-episodes.db", recorder)
    llm = _ConsolidationLlm(json.dumps({"decisions": [{
        "operation": "add", "kind": "semantic", "content": "已经提交的事实",
        "summary": "持久事实", "evidence_moment_ids": [moments[0].moment_id],
    }]}))
    jobs = ConsolidationJobRepository(database)
    coordinator = ConsolidationCoordinator(
        episodes=episodes, memory=memory, jobs=jobs, llm=llm, clock=_TestClock(),
        minimum_salience=0.1, debounce_seconds=0, retry_base_seconds=0,
    )
    await coordinator.start()
    try:
        yield database, repository, memory, episodes, jobs, llm, coordinator
    finally:
        await recorder.stop()


@pytest.mark.parametrize("phase", ["queue_ack", "cache_load", "projection_ack"])
async def test_real_consolidation_recovers_committed_batch_without_model_even_after_rebatch(
    consolidation_stack, monkeypatch, phase,
):
    database, repository, memory, episodes, jobs, llm, coordinator = consolidation_stack

    async def lost_ack(*args, **kwargs):
        raise RuntimeError("injected confirmation loss")

    def lost_projection(*args, **kwargs):
        raise RuntimeError("injected projection confirmation loss")

    with monkeypatch.context() as fault:
        if phase == "queue_ack":
            fault.setattr(jobs, "complete", lost_ack)
        elif phase == "cache_load":
            fault.setattr(memory, "load", lost_ack)
        else:
            fault.setattr(episodes, "mark_consolidated", lost_projection)
        assert await coordinator.consolidate(force_seal=True) == 0
    assert len(llm.requests) == 1
    assert await repository.count() == 1
    async with database.read() as conn:
        states = await (await conn.execute("SELECT state FROM consolidation_jobs")).fetchall()
        expected = "completed" if phase == "projection_ack" else "failed"
        assert states == [(expected,), (expected,)]
    assert len(episodes.pending_consolidation()) == 2
    # 重开真实 Memory 连接且改变 batch size；没有模型也必须能恢复原结果。
    await database.close()
    await database.connect()
    replacement = MemoryController()
    replacement.bind_repository(MemoryRepository(database))
    await replacement.load()
    restarted = ConsolidationCoordinator(
        episodes=episodes, memory=replacement, jobs=ConsolidationJobRepository(database), llm=None,
        clock=_TestClock(), minimum_salience=0.1, debounce_seconds=0, batch_size=1,
    )
    await restarted.start()
    assert await restarted.consolidate() == 0
    assert await restarted.consolidate() == 0
    assert not episodes.pending_consolidation()
    assert len(llm.requests) == 1 and replacement.count() == 1
    async with database.read() as conn:
        assert (await (await conn.execute("SELECT COUNT(*) FROM memory_revisions")).fetchone())[0] == 1
        assert (await (await conn.execute("SELECT COUNT(*) FROM memory_consolidation_receipts")).fetchone())[0] == 1
        assert (await (await conn.execute("SELECT COUNT(*) FROM memory_consolidation_inputs")).fetchone())[0] == 2
        assert await (await conn.execute("SELECT state FROM consolidation_jobs")).fetchall() == [("completed",), ("completed",)]


async def test_old_claim_cannot_complete_new_attempt_or_partially_complete_batch(consolidation_stack):
    database, _, _, episodes, jobs, _, _ = consolidation_stack
    await episodes.project_pending(seal=True)
    for episode in episodes.pending_consolidation():
        await jobs.enqueue(episode, debounce_seconds=0, max_wait_seconds=0)
    old = await jobs.claim_due(limit=2, lease_seconds=60)
    assert len(old) == 2
    async with database.transaction() as conn:
        await conn.execute("UPDATE consolidation_jobs SET lease_until='2000-01-01T00:00:00Z' WHERE job_id=?", (old[1].job_id,))
    await jobs.recover_expired()
    current = await jobs.claim_due(limit=2, lease_seconds=60)
    assert len(current) == 1 and current[0].attempt_count == old[1].attempt_count + 1
    with pytest.raises(MemoryConsolidationConflictError, match="attempt 已失效"):
        await jobs.complete(old)
    await jobs.fail([old[1]], error_code="stale", retry_base_seconds=0)
    async with database.read() as conn:
        assert await (await conn.execute("SELECT state FROM consolidation_jobs")).fetchall() == [("claimed",), ("claimed",)]
    await jobs.complete([old[0], current[0]])
    await jobs.fail([old[0]], error_code="late", retry_base_seconds=0)
    async with database.read() as conn:
        assert await (await conn.execute("SELECT state FROM consolidation_jobs")).fetchall() == [("completed",), ("completed",)]


class _SchedulingProjection:
    def __init__(self) -> None:
        self.project_calls: list[bool] = []
        self.pending_calls = 0

    async def project_pending(self, *, seal: bool = False) -> int:
        self.project_calls.append(seal)
        return 0

    def pending_consolidation(self, *, limit: int = 8) -> list:
        self.pending_calls += 1
        return []


class _SchedulingJobs:
    async def claim_due(self, *, limit: int, lease_seconds: int) -> list:
        return []


async def test_maintenance_scheduler_is_independent_and_quiescent_forces_seal() -> None:
    episodes = _SchedulingProjection()
    coordinator = ConsolidationCoordinator(
        episodes=episodes,
        memory=object(),
        jobs=_SchedulingJobs(),
        llm=None,
        clock=_TestClock(),
    )
    state = "engaged"
    scheduler = MaintenanceScheduler(
        consolidation=coordinator,
        activity_state_provider=lambda: state,
        interval_seconds=300,
    )

    assert await scheduler.run_once() == 0
    assert episodes.project_calls == [False]
    assert episodes.pending_calls == 1

    state = "quiescent"
    scheduler.notify_activity_transition()
    assert scheduler._force_seal_requested is True
    assert await scheduler.run_once(force_seal=True) == 0
    assert episodes.project_calls[-1] is True
    assert episodes.pending_calls == 2


async def test_terminal_moment_wakes_maintenance_without_forced_seal() -> None:
    episodes = _SchedulingProjection()
    coordinator = ConsolidationCoordinator(
        episodes=episodes,
        memory=object(),
        jobs=_SchedulingJobs(),
        llm=None,
        clock=_TestClock(),
    )
    scheduler = MaintenanceScheduler(
        consolidation=coordinator,
        activity_state_provider=lambda: "engaged",
        interval_seconds=300,
    )
    terminal = Moment.create(
        1, kind=MomentKind.REPLY, content={"text": "完成"},
        moment_id=IDS.new(), occurred_at=CLOCK.now_iso()
    )
    scheduler.notify_moment(terminal)

    assert scheduler._wake_event.is_set()
    assert scheduler._force_seal_requested is False
    assert scheduler._pending_reason == "interaction_completed"


async def test_running_scheduler_consolidates_semantic_boundary_without_shutdown(
    tmp_path: Path,
) -> None:
    recorder = build_experience_recorder(tmp_path / "experience")
    await recorder.start()
    database = SqliteMemoryStore(tmp_path / "memory.sqlite")
    await database.connect()
    memory = MemoryController(token_budget=128, result_limit=3)
    memory.bind_repository(MemoryRepository(database))
    await memory.load()
    llm = _ConsolidationLlm('{"decisions":[]}')
    coordinator = ConsolidationCoordinator(
        episodes=EpisodeProjection(
            tmp_path / "projections" / "episodes.db",
            recorder,
        ),
        memory=memory,
        jobs=ConsolidationJobRepository(database),
        llm=llm,
        clock=_TestClock(),
        minimum_salience=0.1,
        debounce_seconds=0,
    )
    scheduler = MaintenanceScheduler(
        consolidation=coordinator,
        activity_state_provider=lambda: "engaged",
        interval_seconds=300,
    )
    recorder.on_recorded(scheduler.notify_moment)
    await scheduler.start()

    evidence = recorder.record(
        MomentKind.PERCEPTION,
        {"text": "本次验收代号是星潮十号"},
        scene_id="desktop",
        interaction_id="turn-live",
        actor_id="user:1",
        retention_ceiling="memory_candidate",
        importance=0.9,
    )
    llm.response = json.dumps({"decisions": [{
        "operation": "add",
        "kind": "semantic",
        "content": "本次验收代号是星潮十号",
        "summary": "验收代号为星潮十号",
        "confidence": 0.99,
        "salience": 0.9,
        "actor_id": "user:1",
        "attributes": {},
        "evidence_moment_ids": [evidence.moment_id],
    }]}, ensure_ascii=False)
    recorder.record(
        MomentKind.REPLY,
        {"text": "我记住了"},
        scene_id="desktop",
        interaction_id="turn-live",
        actor_id="user:1",
    )

    for _ in range(100):
        if await memory.retrieve("星潮十号", actor_id="user:1"):
            break
        await asyncio.sleep(0.02)

    recalled = await memory.retrieve("星潮十号", actor_id="user:1")
    assert recalled and recalled[0].content == "本次验收代号是星潮十号"
    await scheduler.stop()
    await recorder.stop()
    await database.close()


async def test_episode_consolidation_writes_evidence_backed_memory(tmp_path: Path) -> None:
    recorder = build_experience_recorder(tmp_path / "experience")
    await recorder.start()
    moment = recorder.record(
        MomentKind.PERCEPTION,
        {"text": "用户说自己喜欢雨天"},
        scene_id="desktop",
        interaction_id="turn-1",
        actor_id="user:1",
        retention_ceiling="memory_candidate",
        importance=0.9,
    )
    episodes = EpisodeProjection(tmp_path / "projections" / "episodes.db", recorder)
    database = SqliteMemoryStore(tmp_path / "memory.sqlite")
    await database.connect()
    memory = MemoryController(token_budget=128, result_limit=3)
    memory.bind_repository(MemoryRepository(database))
    await memory.load()
    llm = _ConsolidationLlm(json.dumps({"decisions": [{
        "operation": "add",
        "kind": "semantic",
        "content": "用户喜欢雨天",
        "summary": "用户偏好雨天",
        "confidence": 0.9,
        "salience": 0.8,
        "actor_id": "user:1",
        "attributes": {"preference": True},
        "evidence_moment_ids": [moment.moment_id],
    }]}, ensure_ascii=False))
    coordinator = ConsolidationCoordinator(
        episodes=episodes, memory=memory, jobs=ConsolidationJobRepository(database),
        llm=llm, clock=_TestClock(), minimum_salience=0.1, debounce_seconds=0)
    await coordinator.start()

    assert await coordinator.consolidate(force_seal=True) == 1
    assert (await memory.retrieve("雨天", actor_id="user:1"))[0].content == "用户喜欢雨天"
    cursor = await database.connection.execute("SELECT moment_id FROM memory_evidence")
    assert await cursor.fetchone() == (moment.moment_id,)
    assert episodes.pending_consolidation() == []
    await recorder.stop()
    await database.close()


async def test_invalid_consolidation_evidence_remains_retryable(tmp_path: Path) -> None:
    recorder = build_experience_recorder(tmp_path / "experience")
    await recorder.start()
    recorder.record(MomentKind.PERCEPTION, {"text": "候选"}, interaction_id="turn-1",
                    retention_ceiling="memory_candidate", importance=0.9)
    episodes = EpisodeProjection(tmp_path / "projections" / "episodes.db", recorder)
    database = SqliteMemoryStore(tmp_path / "memory.sqlite")
    await database.connect()
    memory = MemoryController(token_budget=128, result_limit=3)
    memory.bind_repository(MemoryRepository(database))
    await memory.load()
    llm = _ConsolidationLlm(
        '{"decisions":[{"operation":"add","kind":"semantic","content":"伪造事实","summary":"伪造",'
        '"confidence":0.9,"salience":0.8,"actor_id":null,'
        '"attributes":{},"evidence_moment_ids":["unknown"]}]}'
    )
    coordinator = ConsolidationCoordinator(
        episodes=episodes, memory=memory, jobs=ConsolidationJobRepository(database),
        llm=llm, clock=_TestClock(), minimum_salience=0.1, debounce_seconds=0)
    await coordinator.start()

    assert await coordinator.consolidate(force_seal=True) == 0
    assert len(episodes.pending_consolidation()) == 1
    cursor = await database.connection.execute("SELECT COUNT(*) FROM memory_items")
    assert (await cursor.fetchone())[0] == 0
    await recorder.stop()
    await database.close()


async def test_consolidation_batches_are_partitioned_by_permission_domain(
    tmp_path: Path,
) -> None:
    recorder = build_experience_recorder(tmp_path / "experience")
    await recorder.start()
    for interaction_id, conversation_id, scope in (
        ("private-turn", "conversation:private", "conversation_private"),
        ("group-turn", "conversation:group", "space_local"),
    ):
        recorder.record(
            MomentKind.PERCEPTION,
            {"text": f"{scope} 候选"},
            scene_id="scene:shared",
            conversation_id=conversation_id,
            interaction_id=interaction_id,
            actor_id="user:1",
            recall_scope=scope,
            disclosure_scope=scope,
            retention_ceiling="memory_candidate",
            importance=0.9,
        )
    episodes = EpisodeProjection(tmp_path / "projections" / "episodes.db", recorder)
    database = SqliteMemoryStore(tmp_path / "memory.sqlite")
    await database.connect()
    memory = MemoryController(token_budget=128, result_limit=3)
    memory.bind_repository(MemoryRepository(database))
    await memory.load()
    llm = _ConsolidationLlm('{"decisions":[]}')
    coordinator = ConsolidationCoordinator(
        episodes=episodes,
        memory=memory,
        jobs=ConsolidationJobRepository(database),
        llm=llm,
        clock=_TestClock(),
        minimum_salience=0.1,
        debounce_seconds=0,
        batch_size=8,
    )
    await coordinator.start()

    assert await coordinator.consolidate(force_seal=True) == 0
    assert len(llm.requests) == 2
    await recorder.stop()
    await database.close()
