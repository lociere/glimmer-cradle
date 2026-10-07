import asyncio
import json
import sqlite3
from dataclasses import asdict, replace
from pathlib import Path

import pytest
from glimmer_cradle.cognition.adapters.persistence.sqlite_planning_store import (
    SqlitePlanningStore,
)
from glimmer_cradle.cognition.inference import InferenceResponse, ModelTier
from glimmer_cradle.cognition.planning import (
    ActionPlan,
    CommitmentStatus,
    Goal,
    GoalVersion,
    PlanningConflictError,
    PlanningController,
    PlanVersion,
)
from glimmer_cradle.cognition.ports import JobReceipt
from tests.conftest import RecordingObservability


class _Reasoning:
    async def request(self, request, *, tier):
        assert tier == ModelTier.LOCAL_ONLY
        assert request.metadata["trace_id"] == "trace-1"
        return InferenceResponse(
            text=(
                '{"action":"skill_request","original_goal":"查天气",'
                '"goal":"查询上海天气","capability_kind":"realtime_lookup",'
                '"reason":"需要实时数据","confidence":0.91}'
            ),
            tier_used=ModelTier.LOCAL_ONLY,
        )


async def test_planning_decision_is_durable_and_recovers_by_trace(
    tmp_path: Path,
) -> None:
    path = tmp_path / "planning.sqlite"
    store = SqlitePlanningStore(path)
    await store.connect()
    controller = PlanningController(
        _Reasoning(), observability=RecordingObservability(), store=store
    )

    plan = await controller.plan(
        goal="  查天气  ",
        scene_id="scene-1",
        trace_id="trace-1",
        tier=ModelTier.LOCAL_ONLY,
    )
    assert plan.action == "skill_request"
    await store.close()

    reopened = SqlitePlanningStore(path)
    await reopened.connect()
    recovered = await reopened.latest(trace_id="trace-1")
    await reopened.close()

    assert recovered is not None
    goal, persisted = recovered
    assert goal.text == "查天气"
    assert goal.scene_id == "scene-1"
    assert persisted.goal == "查询上海天气"
    assert persisted.capability_kind == "realtime_lookup"


async def test_planning_fallback_is_also_journaled(tmp_path: Path) -> None:
    store = SqlitePlanningStore(tmp_path / "planning.sqlite")
    await store.connect()
    controller = PlanningController(
        None, observability=RecordingObservability(), store=store
    )

    plan = await controller.plan(
        goal="普通聊天",
        scene_id="scene-2",
        trace_id="trace-2",
        tier=ModelTier.LOCAL_ONLY,
    )
    recovered = await store.latest(trace_id="trace-2")
    await store.close()

    assert plan.action == "reply"
    assert recovered is not None
    assert recovered[1].reason == "推理服务不可用，降级为普通回复路径"


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
    controller = PlanningController(
        None, observability=RecordingObservability(), store=store
    )
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
    store = SqlitePlanningStore(path)
    await store.connect()
    try:
        await store.record(
            Goal("普通聊天", trace_id="old-trace"), ActionPlan.reply("普通聊天")
        )
        with pytest.raises(PlanningConflictError):
            await store.accept_commitment(
                "commitment-2", _long_plan(version=2), due_at=2
            )
        with sqlite3.connect(path) as connection:
            assert connection.execute(
                "SELECT name FROM sqlite_master WHERE name LIKE 'planning_%' AND type='table'"
            ).fetchall() == [("planning_decision",)]
        assert await store.pending_job_requests() == []
        assert await store.latest(trace_id="old-trace") is not None
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
    controller = PlanningController(
        None, observability=RecordingObservability(), store=store
    )
    receiver = _DurableJobReceiver(receiver_path, lose_reply=True)
    with pytest.raises(ConnectionError):
        await controller.deliver_jobs(receiver)
    assert await store.pending_job_requests() == [source]
    await store.close()
    reopened = SqlitePlanningStore(path)
    await reopened.connect()
    try:
        controller = PlanningController(
            None, observability=RecordingObservability(), store=reopened
        )
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


async def test_cancelled_write_and_repeated_cancel_drain_before_journal_or_read(
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
    write = asyncio.create_task(
        store.accept_commitment("commitment-2", _long_plan(version=2), due_at=2)
    )
    await asyncio.wait_for(inserted.wait(), 2)
    journal = asyncio.create_task(
        store.record(Goal("journal", trace_id="trace-3"), ActionPlan.reply("journal"))
    )
    read = asyncio.create_task(store.load_plan("plan-1", 2))
    write.cancel()
    await asyncio.wait_for(rollback_entered.wait(), 2)
    write.cancel()
    await asyncio.sleep(0)
    assert not journal.done() and not read.done() and not write.done()
    # 独立连接也只能看到已提交的 v1，不能被 journal 偷偷提交 v2。
    assert _counts(path) == (1, 1, 1, 1)
    release_rollback.set()
    with pytest.raises(asyncio.CancelledError):
        await write
    assert await journal > 0 and await read is None
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
