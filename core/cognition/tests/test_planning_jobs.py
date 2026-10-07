import asyncio
import json
import sqlite3
from dataclasses import asdict, replace
from pathlib import Path

import pytest
from glimmer_cradle.cognition.adapters.persistence.sqlite_planning_store import (
    SqlitePlanningStore,
)
from glimmer_cradle.cognition.planning import (
    CommitmentStatus,
    GoalVersion,
    PlanningConflictError,
    PlanningController,
    PlanVersion,
)
from glimmer_cradle.cognition.ports import JobReceipt


def _seed_decision_history(path: Path, *, trace_id: str = "trace-1") -> None:
    """按旧真实 schema 制造历史 fixture；生产没有 journal 写入口。"""
    migration = Path(__file__).resolve().parents[1] / "migrations" / "004-planning.sql"
    with sqlite3.connect(path) as connection:
        connection.executescript(migration.read_text(encoding="utf-8"))
        connection.execute(
            "INSERT INTO planning_decision (trace_id,scene_id,original_goal,planned_goal,"
            "action,capability_kind,reason,confidence,planning_hint) VALUES(?,?,?,?,?,?,?,?,?)",
            (trace_id, "scene-1", "查天气", "查询上海天气", "skill_request",
             "realtime_lookup", "需要实时数据", 0.91, "旧提示"),
        )


async def test_decision_history_reopens_as_read_only_snapshot(tmp_path: Path) -> None:
    from dataclasses import FrozenInstanceError

    path = tmp_path / "planning.sqlite"
    _seed_decision_history(path)
    with sqlite3.connect(path) as connection:
        before = list(connection.iterdump())
    for _ in range(2):
        store = SqlitePlanningStore(path)
        await store.connect()
        try:
            recovered = await store.latest_decision_snapshot(trace_id="trace-1")
            assert recovered is not None
            assert recovered.original_goal == "查天气"
            assert recovered.scene_id == "scene-1"
            assert recovered.planned_goal == "查询上海天气"
            assert recovered.capability_kind == "realtime_lookup"
            assert recovered.planning_hint == "旧提示"
            with pytest.raises(FrozenInstanceError):
                recovered.action = "reply"
            assert await store.latest_decision_snapshot(trace_id="absent") is None
            assert not hasattr(store, "record") and not hasattr(PlanningController, "plan")
        finally:
            await store.close()
        with sqlite3.connect(path) as connection:
            assert list(connection.iterdump()) == before


async def test_unknown_historical_fields_are_not_reinterpreted(tmp_path: Path) -> None:
    path = tmp_path / "planning.sqlite"
    _seed_decision_history(path)
    with sqlite3.connect(path) as connection:
        connection.execute("UPDATE planning_decision SET action='old-unknown',capability_kind='old-kind'")
    store = SqlitePlanningStore(path)
    await store.connect()
    try:
        snapshot = await store.latest_decision_snapshot(trace_id="trace-1")
        assert snapshot.action == "old-unknown" and snapshot.capability_kind == "old-kind"
        assert await store.pending_job_requests() == []
        assert not hasattr(snapshot, "reply")
    finally:
        await store.close()


def _long_plan(*, version: int = 1, scope: str = "scene-1") -> PlanVersion:
    return PlanVersion(
        "plan-1",
        version,
        GoalVersion(
            "goal-1", scope, version, "持续核对变化", "收到可验证的变化证据并完成通知"
        ),
        ("检查受控数据源", "由 Cognition 评估完成条件"),
    )


def _counts(path: Path) -> tuple[int, ...]:
    with sqlite3.connect(path) as connection:
        return tuple(
            connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in (
                "planning_goal_version",
                "planning_plan_version",
                "planning_commitment",
                "planning_job_outbox",
            )
        )


async def test_accepted_commitment_and_source_survive_restart_without_completing_goal(
    tmp_path: Path,
) -> None:
    path = tmp_path / "planning.sqlite"
    store = SqlitePlanningStore(path)
    await store.connect()
    assert await store.pending_job_requests() == []
    with sqlite3.connect(path) as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='planning_job_outbox'"
            ).fetchone()[0]
            == 0
        )
    controller = PlanningController(store=store)
    accepted = await controller.accept_commitment(
        "commitment-1", _long_plan(), due_at=5000
    )
    assert accepted.revision == 1 and accepted.status == CommitmentStatus.ACCEPTED
    first = (await store.pending_job_requests())[0]
    assert first.scope_id == "scene-1" and first.due_at == 5000
    assert first.kind == "planning.evaluate" and first.payload == {
        "commitment_id": "commitment-1",
        "plan_id": "plan-1",
        "plan_version": 1,
        "goal_version": 1,
    }
    await store.close()
    reopened = SqlitePlanningStore(path)
    await reopened.connect()
    try:
        assert await reopened.load_plan("plan-1", 1) == _long_plan()
        assert await reopened.load_commitment("commitment-1") == accepted
        assert await reopened.pending_job_requests() == [first]
        assert (
            await reopened.accept_commitment("commitment-1", _long_plan(), due_at=5000)
            == accepted
        )
        await reopened.acknowledge_job_request(
            first, JobReceipt("job-1", "accepted", 1)
        )
        await reopened.acknowledge_job_request(
            first, JobReceipt("job-1", "duplicate", 9)
        )
        assert await reopened.pending_job_requests() == []
        assert await reopened.load_commitment("commitment-1") == accepted
        assert _counts(path) == (1, 1, 1, 1)
    finally:
        await reopened.close()


async def test_immutable_versions_due_policy_and_scope_conflicts_roll_back(
    tmp_path: Path,
) -> None:
    path = tmp_path / "planning.sqlite"
    store = SqlitePlanningStore(path)
    await store.connect()
    try:
        first = await store.accept_commitment("commitment-1", _long_plan(), due_at=5000)
        candidates = (
            (_long_plan(), 5001),
            (replace(_long_plan(), steps=("修改既有步骤",)), 5000),
            (
                replace(
                    _long_plan(),
                    goal=replace(_long_plan().goal, completion_condition="偷偷覆盖"),
                ),
                5000,
            ),
            (_long_plan(version=3), 5000),
            (_long_plan(version=2, scope="foreign-scope"), 5000),
            (_long_plan(version=2), 5000),  # 同一承诺不能换绑另一版本。
        )
        for plan, due in candidates:
            with pytest.raises(PlanningConflictError):
                await store.accept_commitment("commitment-1", plan, due_at=due)
            assert _counts(path) == (1, 1, 1, 1)
        second = await store.accept_commitment(
            "commitment-2", _long_plan(version=2), due_at=6000
        )
        assert second.plan_version == 2 and second.revision == 1
        assert await store.load_commitment("commitment-1") == first
        assert await store.load_plan("plan-1", 1) == _long_plan()
        assert _counts(path) == (2, 2, 2, 2)
        regressed = replace(_long_plan(version=3), goal=_long_plan().goal)
        with pytest.raises(PlanningConflictError):
            await store.accept_commitment("commitment-3", regressed, due_at=7000)
        assert _counts(path) == (2, 2, 2, 2)
    finally:
        await store.close()


@pytest.mark.parametrize(
    "table",
    [
        "planning_goal_version",
        "planning_plan_version",
        "planning_commitment",
        "planning_job_outbox",
    ],
)
async def test_long_term_acceptance_is_one_transaction_at_every_write(
    tmp_path: Path, table: str
) -> None:
    path = tmp_path / "planning.sqlite"
    store = SqlitePlanningStore(path)
    await store.connect()
    try:
        await store.accept_commitment("commitment-1", _long_plan(), due_at=1)
        with sqlite3.connect(path) as connection:
            connection.execute(
                f"CREATE TRIGGER fixture_fault BEFORE INSERT ON {table} BEGIN SELECT RAISE(ABORT,'fixture fault'); END"
            )
        with pytest.raises(sqlite3.IntegrityError, match="fixture fault"):
            await store.accept_commitment(
                "commitment-2", _long_plan(version=2), due_at=2
            )
        assert _counts(path) == (1, 1, 1, 1)
        assert await store.load_plan("plan-1", 2) is None
        with sqlite3.connect(path) as connection:
            connection.execute("DROP TRIGGER fixture_fault")
        await store.accept_commitment("commitment-2", _long_plan(version=2), due_at=2)
        assert _counts(path) == (2, 2, 2, 2)
    finally:
        await store.close()


async def test_two_independent_connections_accept_identical_sources_once(
    tmp_path: Path,
) -> None:
    path = tmp_path / "planning.sqlite"
    first, second = SqlitePlanningStore(path), SqlitePlanningStore(path)
    await first.connect()
    await second.connect()
    try:
        accepted = await asyncio.gather(
            first.accept_commitment("commitment-1", _long_plan(), due_at=123),
            second.accept_commitment("commitment-1", _long_plan(), due_at=123),
        )
        assert accepted[0] == accepted[1]
        assert _counts(path) == (1, 1, 1, 1)
        assert await first.pending_job_requests() == await second.pending_job_requests()
    finally:
        await first.close()
        await second.close()


async def test_ack_rejects_payload_or_job_conflicts_and_keeps_pending_source(
    tmp_path: Path,
) -> None:
    path = tmp_path / "planning.sqlite"
    store = SqlitePlanningStore(path)
    await store.connect()
    try:
        await store.accept_commitment("commitment-1", _long_plan(), due_at=123)
        request = (await store.pending_job_requests())[0]
        for receipt in (
            JobReceipt("job-1", "rejected", 1),
            JobReceipt("", "accepted", 1),
            JobReceipt("job-1", "accepted", True),
        ):
            with pytest.raises(PlanningConflictError):
                await store.acknowledge_job_request(request, receipt)
        modified = replace(request, payload={**request.payload, "goal_version": 2})
        with pytest.raises(PlanningConflictError):
            await store.acknowledge_job_request(
                modified, JobReceipt("job-1", "accepted", 1)
            )
        assert await store.pending_job_requests() == [request]
        with sqlite3.connect(path) as connection:
            connection.execute(
                "CREATE TRIGGER fixture_ack_fault BEFORE UPDATE ON planning_job_outbox BEGIN SELECT RAISE(ABORT,'ACK fault'); END"
            )
        with pytest.raises(sqlite3.IntegrityError, match="ACK fault"):
            await store.acknowledge_job_request(
                request, JobReceipt("job-1", "accepted", 1)
            )
        assert await store.pending_job_requests() == [request]
        with sqlite3.connect(path) as connection:
            connection.execute("DROP TRIGGER fixture_ack_fault")
        await store.acknowledge_job_request(request, JobReceipt("job-1", "accepted", 1))
        with pytest.raises(PlanningConflictError):
            await store.acknowledge_job_request(
                request, JobReceipt("other-job", "duplicate", 2)
            )
        assert await store.pending_job_requests() == []
    finally:
        await store.close()


class _DurableJobReceiver:
    """两个真实 SQLite 的提交窗口 fixture；不冒充生产 Host Jobs broker。"""

    def __init__(self, path: Path, *, lose_reply: bool = False) -> None:
        self.path, self.lose_reply = path, lose_reply
        with sqlite3.connect(path) as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS source(request_id TEXT PRIMARY KEY,payload TEXT NOT NULL)"
            )

    async def request(self, request):
        with sqlite3.connect(self.path) as connection:
            cursor = connection.execute(
                "INSERT OR IGNORE INTO source VALUES(?,?)",
                (request.request_id, json.dumps(asdict(request), sort_keys=True)),
            )
            duplicate = cursor.rowcount == 0
        if self.lose_reply:
            self.lose_reply = False
            raise ConnectionError("fixture reply lost after commit")
        return JobReceipt(
            "job:" + request.request_id, "duplicate" if duplicate else "accepted", 1
        )


async def test_first_failed_acceptance_rolls_back_lazy_schema_and_preserves_journal(
    tmp_path: Path,
) -> None:
    path = tmp_path / "planning.sqlite"
    _seed_decision_history(path, trace_id="old-trace")
    store = SqlitePlanningStore(path)
    await store.connect()
    try:
        with pytest.raises(PlanningConflictError):
            await store.accept_commitment(
                "commitment-2", _long_plan(version=2), due_at=2
            )
        with sqlite3.connect(path) as connection:
            assert connection.execute(
                "SELECT name FROM sqlite_master WHERE name LIKE 'planning_%' AND type='table'"
            ).fetchall() == [("planning_decision",)]
        assert await store.pending_job_requests() == []
        assert await store.latest_decision_snapshot(trace_id="old-trace") is not None
        await store.accept_commitment("commitment-1", _long_plan(), due_at=1)
        assert _counts(path) == (1, 1, 1, 1)
        oversized = replace(_long_plan(version=2), steps=("大" * 30_000,))
        with pytest.raises(PlanningConflictError, match="64 KiB"):
            await store.accept_commitment("commitment-2", oversized, due_at=2)
        assert _counts(path) == (1, 1, 1, 1)
    finally:
        await store.close()


async def test_acceptance_cancelled_after_commit_replays_durable_identity(
    tmp_path: Path, monkeypatch
) -> None:
    path = tmp_path / "planning.sqlite"
    store = SqlitePlanningStore(path)
    await store.connect()
    connection = store._require_connection()
    original_commit = connection.commit
    committed = asyncio.Event()

    async def lose_commit_reply():
        await original_commit()
        committed.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(connection, "commit", lose_commit_reply)
    write = asyncio.create_task(
        store.accept_commitment("commitment-1", _long_plan(), due_at=1)
    )
    await asyncio.wait_for(committed.wait(), 2)
    write.cancel()
    with pytest.raises(asyncio.CancelledError):
        await write
    monkeypatch.setattr(connection, "commit", original_commit)
    try:
        assert _counts(path) == (1, 1, 1, 1)
        recovered = await store.accept_commitment(
            "commitment-1", _long_plan(), due_at=1
        )
        assert recovered.status == CommitmentStatus.ACCEPTED and recovered.revision == 1
        assert len(await store.pending_job_requests()) == 1
        assert _counts(path) == (1, 1, 1, 1)
    finally:
        await store.close()


async def test_rollback_failure_revokes_connection_without_discarding_durable_state(
    tmp_path: Path, monkeypatch
) -> None:
    path = tmp_path / "planning.sqlite"
    store = SqlitePlanningStore(path)
    await store.connect()
    await store.accept_commitment("commitment-1", _long_plan(), due_at=1)

    async def failed_rollback():
        raise RuntimeError("fixture rollback unavailable")

    monkeypatch.setattr(store._require_connection(), "rollback", failed_rollback)
    with pytest.raises(BaseExceptionGroup, match="连接已撤销"):
        await store.accept_commitment("commitment-1", _long_plan(version=2), due_at=1)
    with pytest.raises(RuntimeError, match="not connected"):
        await store.pending_job_requests()
    assert _counts(path) == (1, 1, 1, 1)
    reopened = SqlitePlanningStore(path)
    await reopened.connect()
    try:
        assert len(await reopened.pending_job_requests()) == 1
        assert await reopened.load_plan("plan-1", 2) is None
    finally:
        await reopened.close()


async def test_jobs_commit_reply_loss_then_source_restart_replays_same_request(
    tmp_path: Path,
) -> None:
    path, receiver_path = tmp_path / "planning.sqlite", tmp_path / "receiver.sqlite"
    store = SqlitePlanningStore(path)
    await store.connect()
    await store.accept_commitment("commitment-1", _long_plan(), due_at=123)
    source = (await store.pending_job_requests())[0]
    controller = PlanningController(store=store)
    receiver = _DurableJobReceiver(receiver_path, lose_reply=True)
    with pytest.raises(ConnectionError):
        await controller.deliver_jobs(receiver)
    assert await store.pending_job_requests() == [source]
    await store.close()
    reopened = SqlitePlanningStore(path)
    await reopened.connect()
    try:
        controller = PlanningController(store=reopened)
        assert await controller.deliver_jobs(_DurableJobReceiver(receiver_path)) == 1
        assert await controller.deliver_jobs(_DurableJobReceiver(receiver_path)) == 0
        with sqlite3.connect(receiver_path) as connection:
            assert connection.execute("SELECT COUNT(*) FROM source").fetchone()[0] == 1
        commitment = await reopened.load_commitment("commitment-1")
        assert commitment is not None and commitment.status == CommitmentStatus.ACCEPTED
    finally:
        await reopened.close()


@pytest.mark.parametrize("fault", ["unknown-version", "missing-table", "orphan-table"])
async def test_unsupported_or_partial_long_term_schema_never_auto_repairs(
    tmp_path: Path, fault: str
) -> None:
    path = tmp_path / "planning.sqlite"
    store = SqlitePlanningStore(path)
    await store.connect()
    if fault != "orphan-table":
        await store.accept_commitment("commitment-1", _long_plan(), due_at=123)
    await store.close()
    with sqlite3.connect(path) as connection:
        if fault == "unknown-version":
            connection.execute("UPDATE planning_long_term_meta SET value='99'")
        elif fault == "missing-table":
            connection.execute("DROP TABLE planning_job_outbox")
        else:
            connection.execute("CREATE TABLE planning_job_outbox(fixture TEXT)")
        before = connection.iterdump()
        snapshot = list(before)
    reopened = SqlitePlanningStore(path)
    with pytest.raises(PlanningConflictError):
        await reopened.connect()
    with sqlite3.connect(path) as connection:
        assert list(connection.iterdump()) == snapshot


async def test_cancelled_write_and_repeated_cancel_drain_before_ack_or_read(
    tmp_path: Path, monkeypatch
) -> None:
    path = tmp_path / "planning.sqlite"
    store = SqlitePlanningStore(path)
    await store.connect()
    await store.accept_commitment("commitment-1", _long_plan(), due_at=1)
    inserted, rollback_entered, release_rollback = (
        asyncio.Event(),
        asyncio.Event(),
        asyncio.Event(),
    )
    connection = store._require_connection()
    original_plan, original_rollback = store._persist_plan, connection.rollback

    async def paused_plan(conn, plan, payload):
        await original_plan(conn, plan, payload)
        inserted.set()
        await asyncio.Event().wait()

    async def paused_rollback():
        rollback_entered.set()
        await release_rollback.wait()
        await original_rollback()

    monkeypatch.setattr(store, "_persist_plan", paused_plan)
    monkeypatch.setattr(connection, "rollback", paused_rollback)
    pending = (await store.pending_job_requests())[0]
    write = asyncio.create_task(
        store.accept_commitment("commitment-2", _long_plan(version=2), due_at=2)
    )
    await asyncio.wait_for(inserted.wait(), 2)
    ack = asyncio.create_task(
        store.acknowledge_job_request(
            pending, JobReceipt("job-1", "accepted", 1)
        )
    )
    read = asyncio.create_task(store.load_plan("plan-1", 2))
    write.cancel()
    await asyncio.wait_for(rollback_entered.wait(), 2)
    write.cancel()
    await asyncio.sleep(0)
    assert not ack.done() and not read.done() and not write.done()
    # 独立连接也只能看到已提交的 v1，不能被 ACK 偷偷提交 v2。
    assert _counts(path) == (1, 1, 1, 1)
    release_rollback.set()
    with pytest.raises(asyncio.CancelledError):
        await write
    assert await ack is None and await read is None
    assert await store.pending_job_requests() == []
    assert _counts(path) == (1, 1, 1, 1)
    monkeypatch.setattr(store, "_persist_plan", original_plan)
    await store.accept_commitment("commitment-2", _long_plan(version=2), due_at=2)
    await store.close()


@pytest.mark.parametrize("value", [True, -1, 2**53])
async def test_invalid_due_time_does_not_create_long_term_state(
    tmp_path: Path, value: int
) -> None:
    path = tmp_path / "planning.sqlite"
    store = SqlitePlanningStore(path)
    await store.connect()
    try:
        with pytest.raises(PlanningConflictError):
            await store.accept_commitment("commitment-1", _long_plan(), due_at=value)
        assert await store.pending_job_requests() == []
        with pytest.raises(PlanningConflictError):
            await store.pending_job_requests(limit=value)
    finally:
        await store.close()
