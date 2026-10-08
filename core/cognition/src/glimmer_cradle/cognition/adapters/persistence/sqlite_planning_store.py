"""SQLite implementation of the Cognition planning journal."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path

import aiosqlite
from glimmer_cradle.cognition.planning.commitment import (
    Commitment,
    CommitmentStatus,
    PlanningEvaluationReceipt,
    PlanningJobFeedback,
    PlanningJobIdentity,
    PlanningJobResult,
    PlanningNotificationDelivery,
    PlanningNotificationRequest,
)
from glimmer_cradle.cognition.planning.goal import GoalVersion, PlanningAssessment
from glimmer_cradle.cognition.planning.plan import PlanVersion
from glimmer_cradle.cognition.planning.planning_store import (
    PlanningConflictError,
    PlanningDecisionSnapshot,
    PlanningEvaluationWork,
    PlanningNotificationWork,
)
from glimmer_cradle.cognition.ports.job_port import (
    JobReceipt,
    JobRequest,
    PlanningEvidenceReference,
)

# 普通 journal 启动不迁入长期承诺；首次显式接受才建立这个独立版本窗口。
_COMMITMENT_TABLES = (
    "planning_long_term_meta",
    "planning_goal_version",
    "planning_plan_version",
    "planning_commitment",
    "planning_job_outbox",
)
_COMMITMENT_SCHEMA = (
    "CREATE TABLE planning_long_term_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    (
        "CREATE TABLE planning_goal_version (goal_id TEXT NOT NULL,version INTEGER NOT NULL,"
        "scope_id TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(goal_id,version))"
    ),
    (
        "CREATE TABLE planning_plan_version (plan_id TEXT NOT NULL,version INTEGER NOT NULL,"
        "goal_id TEXT NOT NULL,goal_version INTEGER NOT NULL,payload_json TEXT NOT NULL,"
        "PRIMARY KEY(plan_id,version),FOREIGN KEY(goal_id,goal_version) REFERENCES planning_goal_version(goal_id,version))"
    ),
    (
        "CREATE TABLE planning_commitment (commitment_id TEXT PRIMARY KEY,plan_id TEXT NOT NULL,"
        "plan_version INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('proposed','accepted','completed','abandoned')),"
        "revision INTEGER NOT NULL CHECK(revision>0),FOREIGN KEY(plan_id,plan_version) REFERENCES planning_plan_version(plan_id,version))"
    ),
    (
        "CREATE TABLE planning_job_outbox (request_id TEXT PRIMARY KEY,commitment_id TEXT NOT NULL UNIQUE,"
        "payload_json TEXT NOT NULL,accepted_job_id TEXT,accepted_revision INTEGER,"
        "FOREIGN KEY(commitment_id) REFERENCES planning_commitment(commitment_id),"
        "CHECK((accepted_job_id IS NULL AND accepted_revision IS NULL) OR (accepted_job_id IS NOT NULL AND accepted_revision>0)))"
    ),
)

# 显式评估才建立新版本窗口；不改变旧长期表/schema 1 或回写历史 journal。
_EVALUATION_TABLES = ("planning_evaluation_meta", "planning_evaluation_attempt", "planning_evaluation_receipt")
_EVALUATION_SCHEMA = (
    "CREATE TABLE planning_evaluation_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    ("CREATE TABLE planning_evaluation_attempt (job_id TEXT NOT NULL,attempt INTEGER NOT NULL CHECK(attempt>0),"
    "scope_id TEXT NOT NULL,authority_epoch INTEGER NOT NULL CHECK(authority_epoch>0),"
    "fencing_token INTEGER NOT NULL CHECK(fencing_token>0),owner_id TEXT NOT NULL,lease_until INTEGER NOT NULL,"
    "request_id TEXT NOT NULL,work_digest TEXT,state TEXT NOT NULL CHECK(state IN ('active','sealed','applied')),"
    "receipt_id TEXT,observed_at INTEGER,PRIMARY KEY(job_id,attempt),"
    "FOREIGN KEY(request_id) REFERENCES planning_job_outbox(request_id),"
    "FOREIGN KEY(receipt_id) REFERENCES planning_evaluation_receipt(receipt_id),"
    "CHECK((state='applied' AND receipt_id IS NOT NULL AND observed_at IS NOT NULL) OR "
    "(state='sealed' AND receipt_id IS NULL AND observed_at IS NOT NULL) OR "
    "(state='active' AND receipt_id IS NULL AND observed_at IS NULL AND work_digest IS NOT NULL)))"),
    "CREATE TABLE planning_evaluation_receipt (job_id TEXT PRIMARY KEY,receipt_id TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL)",
)

# 状态接纳的独立增量窗口；queued 反馈不创建评估 attempt 或改写承诺。
_FEEDBACK_TABLES = ("planning_job_feedback_meta", "planning_job_feedback_inbox", "planning_job_projection")
_FEEDBACK_SCHEMA = (
    "CREATE TABLE planning_job_feedback_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    ("CREATE TABLE planning_job_feedback_inbox (event_id TEXT PRIMARY KEY,event_digest TEXT NOT NULL,"
     "request_id TEXT NOT NULL,FOREIGN KEY(request_id) REFERENCES planning_job_outbox(request_id))"),
    ("CREATE TABLE planning_job_projection (request_id TEXT PRIMARY KEY,job_id TEXT NOT NULL UNIQUE,"
     "revision INTEGER NOT NULL,job_epoch INTEGER NOT NULL,status TEXT NOT NULL,receipt_id TEXT,"
     "updated_at INTEGER NOT NULL,business_outcome TEXT NOT NULL CHECK(business_outcome IN ('committed','unknown')),"
     "FOREIGN KEY(request_id) REFERENCES planning_job_outbox(request_id))"),
)

# 完成通知引用与业务 receipt 同事务产生；没有 receiver 时不能以本地 ACK 删除。
_NOTIFICATION_TABLES = ("planning_notification_meta", "planning_notification_outbox")
_NOTIFICATION_SCHEMA = (
    "CREATE TABLE planning_notification_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    ("CREATE TABLE planning_notification_outbox (notification_id TEXT PRIMARY KEY,receipt_id TEXT NOT NULL UNIQUE,"
     "request_id TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL,"
     "FOREIGN KEY(receipt_id) REFERENCES planning_evaluation_receipt(receipt_id),"
     "FOREIGN KEY(request_id) REFERENCES planning_job_outbox(request_id))"),
)

# 只在显式真实回执接纳时建立；原 outbox 留存，不补造历史送达。
_NOTIFICATION_DELIVERY_TABLES = ("planning_notification_delivery_meta", "planning_notification_delivery_receipt")
_NOTIFICATION_DELIVERY_SCHEMA = (
    "CREATE TABLE planning_notification_delivery_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    ("CREATE TABLE planning_notification_delivery_receipt (notification_id TEXT PRIMARY KEY,"
     "receipt_id TEXT NOT NULL UNIQUE,payload_json TEXT NOT NULL,acknowledged_at_ms INTEGER NOT NULL,"
     "FOREIGN KEY(notification_id) REFERENCES planning_notification_outbox(notification_id))"),
)


def _matches_feedback_result(actual: object, expected: object) -> bool:
    # protobuf Struct 的安全整数经 JSON mapper 成 float；bool 不可冒充数字或完成值。
    if isinstance(expected, dict):
        return isinstance(actual, dict) and actual.keys() == expected.keys() and all(
            _matches_feedback_result(actual[key], value) for key, value in expected.items())
    if isinstance(expected, list):
        return isinstance(actual, list) and len(actual) == len(expected) and all(
            _matches_feedback_result(left, right) for left, right in zip(actual, expected, strict=True))
    if type(expected) is int:
        return type(actual) in {int, float} and actual == expected
    return type(actual) is type(expected) and actual == expected


def _canonical(value: object) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    if len(payload.encode("utf-8")) > 65_536:
        raise PlanningConflictError("Planning 持久信封超过 64 KiB")
    return payload


def _goal_document(goal: GoalVersion) -> dict:
    document = asdict(goal)
    if goal.source_moment_id is None:
        # 旧不可变版本与 active work 摘要保持字节语义，不给历史目标补造访问资格。
        for key in ("source_moment_id", "source_digest", "model_tier"):
            document.pop(key)
    return document


def _plan_document(plan: PlanVersion) -> dict:
    return {**asdict(plan), "goal": _goal_document(plan.goal)}


def _work_document(work: PlanningEvaluationWork) -> dict:
    return {**asdict(work), "plan": _plan_document(work.plan)}


class SqlitePlanningStore:
    def __init__(self, path: Path, *, migration_path: Path | None = None, now_ms: Callable[[], int] | None = None) -> None:
        self._path = path
        self._migration_path = migration_path or (
            Path(__file__).resolve().parents[5] / "migrations" / "004-planning.sql"
        )
        self._connection: aiosqlite.Connection | None = None
        self._connection_lock = asyncio.Lock()
        self._clock = now_ms or (lambda: time.time_ns() // 1_000_000)
        self._last_time = 0

    def _clock_now(self) -> int:
        value = self._clock()
        if type(value) is not int or not 0 <= value <= 2**53 - 1:
            raise PlanningConflictError("Planning 时钟无效")
        self._last_time = max(self._last_time, value)
        return self._last_time

    async def connect(self) -> None:
        async with self._connection_lock:
            if self._connection is not None:
                return
            self._path.parent.mkdir(parents=True, exist_ok=True)
            connection = aiosqlite.connect(self._path)
            try:
                await connection
                connection.row_factory = aiosqlite.Row
                await connection.execute("PRAGMA foreign_keys=ON")
                await connection.create_function("planning_now_ms", 0, self._clock_now)
                await self._commitment_schema(connection)
                await self._evaluation_schema(connection)
                await self._feedback_schema(connection)
                await self._notification_schema(connection)
                await self._notification_delivery_schema(connection)
                cursor = await connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                )
                tables = {row[0] for row in await cursor.fetchall()}
                if "planning_decision" not in tables:
                    if tables:
                        raise PlanningConflictError(
                            "数据库不是 Planning journal；拒绝自动修复"
                        )
                    await connection.executescript(
                        "BEGIN IMMEDIATE;\n"
                        + self._migration_path.read_text(encoding="utf-8")
                    )
                    await connection.commit()
                await connection.execute(
                    "SELECT trace_id,scene_id,original_goal,planned_goal,action,capability_kind,reason,confidence,planning_hint FROM planning_decision LIMIT 0"
                )
            except BaseException:
                await self._drain_cleanup(connection.close())
                raise
            self._connection = connection

    async def close(self) -> None:
        async with self._connection_lock:
            connection, self._connection = self._connection, None
            if connection is not None:
                await self._drain_cleanup(connection.close(), propagate_cancel=True)

    async def latest_decision_snapshot(self, *, trace_id: str) -> PlanningDecisionSnapshot | None:
        async with self._connection_lock:
            return await self._latest_decision_snapshot(trace_id=trace_id)

    async def _latest_decision_snapshot(self, *, trace_id: str) -> PlanningDecisionSnapshot | None:
        connection = self._require_connection()
        cursor = await connection.execute(
            """
            SELECT trace_id, scene_id, original_goal, planned_goal, action,
                   capability_kind, reason, confidence, planning_hint
              FROM planning_decision
             WHERE trace_id = ?
             ORDER BY decision_id DESC
             LIMIT 1
            """,
            (trace_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return PlanningDecisionSnapshot(
            trace_id=str(row["trace_id"]),
            scene_id=str(row["scene_id"]),
            original_goal=str(row["original_goal"]),
            planned_goal=str(row["planned_goal"]),
            action=str(row["action"]),
            capability_kind=str(row["capability_kind"]),
            reason=str(row["reason"]),
            confidence=float(row["confidence"]),
            planning_hint=row["planning_hint"],
        )

    async def accept_commitment(
        self, commitment_id: str, plan: PlanVersion, *, due_at: int
    ) -> Commitment:
        if not isinstance(commitment_id, str) or not commitment_id.strip():
            raise PlanningConflictError("承诺身份不得为空")
        if (
            not isinstance(plan, PlanVersion)
            or type(due_at) is not int
            or not 0 <= due_at <= 2**53 - 1
        ):
            raise PlanningConflictError("长期计划或 due time 无效")
        goal_payload, plan_payload = (
            _canonical(_goal_document(plan.goal)),
            _canonical(_plan_document(plan)),
        )
        identity = json.dumps(
            ["planning.evaluate", commitment_id, plan.plan_id, plan.version],
            ensure_ascii=False,
            separators=(",", ":"),
        )
        request_id = hashlib.sha256(identity.encode("utf-8")).hexdigest()
        request = JobRequest(
            request_id=request_id,
            goal_id=plan.goal.goal_id,
            kind="planning.evaluate",
            payload={
                "commitment_id": commitment_id,
                "plan_id": plan.plan_id,
                "plan_version": plan.version,
                "goal_version": plan.goal.version,
            },
            idempotency_key=request_id,
            scope_id=plan.goal.scope_id,
            due_at=due_at,
        )
        request_payload = _canonical(asdict(request))
        async with self._transaction() as connection:
            await self._commitment_schema(connection, create=True)
            await self._persist_goal(connection, plan.goal, goal_payload)
            await self._persist_plan(connection, plan, plan_payload)
            cursor = await connection.execute(
                "SELECT * FROM planning_commitment WHERE commitment_id=?",
                (commitment_id,),
            )
            existing = await cursor.fetchone()
            if existing is not None:
                cursor = await connection.execute(
                    "SELECT request_id,payload_json FROM planning_job_outbox WHERE commitment_id=?",
                    (commitment_id,),
                )
                source = await cursor.fetchone()
                if (
                    (existing["plan_id"], existing["plan_version"])
                    != (plan.plan_id, plan.version)
                    or source is None
                    or (source["request_id"], source["payload_json"])
                    != (request_id, request_payload)
                ):
                    raise PlanningConflictError("同一承诺的计划或首次调度信封冲突")
                return self._commitment(existing)
            await connection.execute(
                "INSERT INTO planning_commitment VALUES(?,?,?,'accepted',1)",
                (commitment_id, plan.plan_id, plan.version),
            )
            await connection.execute(
                "INSERT INTO planning_job_outbox(request_id,commitment_id,payload_json) VALUES(?,?,?)",
                (request_id, commitment_id, request_payload),
            )
            return Commitment(
                commitment_id, plan.plan_id, CommitmentStatus.ACCEPTED, 1, plan.version
            )

    async def load_commitment(self, commitment_id: str) -> Commitment | None:
        async with self._connection_lock:
            connection = self._require_connection()
            if not await self._commitment_schema(connection):
                return None
            cursor = await connection.execute(
                "SELECT * FROM planning_commitment WHERE commitment_id=?",
                (commitment_id,),
            )
            row = await cursor.fetchone()
            return self._commitment(row) if row is not None else None

    async def load_plan(self, plan_id: str, version: int) -> PlanVersion | None:
        async with self._connection_lock:
            connection = self._require_connection()
            if not await self._commitment_schema(connection):
                return None
            cursor = await connection.execute(
                "SELECT payload_json FROM planning_plan_version WHERE plan_id=? AND version=?",
                (plan_id, version),
            )
            row = await cursor.fetchone()
            if row is None:
                return None
            payload = json.loads(row[0])
            return PlanVersion(
                payload["plan_id"],
                payload["version"],
                GoalVersion(**payload["goal"]),
                tuple(payload["steps"]),
            )

    async def pending_job_requests(self, *, limit: int = 64) -> list[JobRequest]:
        if type(limit) is not int or not 1 <= limit <= 1000:
            raise PlanningConflictError("Planning 源投递批次无效")
        async with self._connection_lock:
            connection = self._require_connection()
            if not await self._commitment_schema(connection):
                return []
            cursor = await connection.execute(
                "SELECT payload_json FROM planning_job_outbox WHERE accepted_job_id IS NULL ORDER BY request_id LIMIT ?",
                (limit,),
            )
            return [JobRequest(**json.loads(row[0])) for row in await cursor.fetchall()]

    async def acknowledge_job_request(
        self, request: JobRequest, receipt: JobReceipt
    ) -> None:
        if (
            not isinstance(request, JobRequest)
            or not isinstance(receipt, JobReceipt)
            or (
                receipt.status not in {"accepted", "duplicate"}
                or not isinstance(receipt.job_id, str)
                or not receipt.job_id.strip()
                or type(receipt.revision) is not int
                or not 1 <= receipt.revision <= 2**53 - 1
            )
        ):
            raise PlanningConflictError("Jobs 未提供有效持久接纳回执")
        payload = _canonical(asdict(request))
        async with self._transaction() as connection:
            if not await self._commitment_schema(connection):
                raise PlanningConflictError("Planning 源请求不存在")
            cursor = await connection.execute(
                "SELECT * FROM planning_job_outbox WHERE request_id=?",
                (request.request_id,),
            )
            row = await cursor.fetchone()
            if row is None or row["payload_json"] != payload:
                raise PlanningConflictError("Planning 源请求内容冲突")
            if row["accepted_job_id"] is not None:
                if row["accepted_job_id"] != receipt.job_id:
                    raise PlanningConflictError("Planning 源请求已绑定不同 Job")
                return
            await connection.execute(
                "UPDATE planning_job_outbox SET accepted_job_id=?,accepted_revision=? WHERE request_id=?",
                (receipt.job_id, receipt.revision, request.request_id),
            )

    @staticmethod
    def _evaluation_identity(identity: PlanningJobIdentity, request_id: str) -> None:
        if not isinstance(identity, PlanningJobIdentity) or not isinstance(request_id, str) or not re.fullmatch(r"[a-f0-9]{64}", request_id):
            raise PlanningConflictError("Planning 评估身份/来源无效")

    @staticmethod
    async def _evaluation_work(connection: aiosqlite.Connection, job_id: str, scope_id: str, request_id: str) -> PlanningEvaluationWork:
        cursor = await connection.execute("SELECT * FROM planning_job_outbox WHERE request_id=?", (request_id,))
        source = await cursor.fetchone()
        if source is None or source["accepted_job_id"] != job_id:
            raise PlanningConflictError("Planning Job 未被源持久接纳")
        request = JobRequest(**json.loads(source["payload_json"]))
        cursor = await connection.execute("SELECT * FROM planning_commitment WHERE commitment_id=?", (source["commitment_id"],))
        row = await cursor.fetchone()
        if row is None:
            raise PlanningConflictError("Planning 承诺丢失")
        commitment = SqlitePlanningStore._commitment(row)
        cursor = await connection.execute("SELECT payload_json FROM planning_plan_version WHERE plan_id=? AND version=?",
                                          (commitment.plan_id, commitment.plan_version))
        plan_row = await cursor.fetchone()
        if plan_row is None:
            raise PlanningConflictError("Planning 计划版本丢失")
        payload = json.loads(plan_row[0])
        plan = PlanVersion(payload["plan_id"], payload["version"], GoalVersion(**payload["goal"]), tuple(payload["steps"]))
        expected_id = hashlib.sha256(json.dumps(["planning.evaluate", commitment.commitment_id, plan.plan_id, plan.version],
                                               ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()
        if (request.request_id != request_id or request.idempotency_key != request_id or request_id != expected_id
            or request.kind != "planning.evaluate" or request.scope_id != scope_id or plan.goal.scope_id != scope_id
            or request.goal_id != plan.goal.goal_id or request.payload != {
                "commitment_id": commitment.commitment_id, "plan_id": plan.plan_id,
                "plan_version": plan.version, "goal_version": plan.goal.version,
            }):
            raise PlanningConflictError("Planning 原来源/计划/scope 冲突")
        return PlanningEvaluationWork(request_id, commitment, plan)

    async def read_evaluation_work(self, *, job_id: str, scope_id: str, request_id: str) -> PlanningEvaluationWork:
        """只读取真实已 ACK 来源；不伪造 attempt，也不初始化或封口评估窗口。"""
        if not isinstance(request_id, str) or not re.fullmatch(r"[a-f0-9]{64}", request_id) \
                or job_id != f"planning:{request_id}" or not isinstance(scope_id, str) or not scope_id.strip():
            raise PlanningConflictError("Planning 接纳查询身份无效")
        async with self._transaction() as connection:
            if not await self._commitment_schema(connection):
                raise PlanningConflictError("Planning 源不存在")
            return await self._evaluation_work(connection, job_id, scope_id, request_id)

    async def accept_job_feedback(self, feedback: PlanningJobFeedback, result: dict | None) -> bool:
        if not isinstance(feedback, PlanningJobFeedback):
            raise PlanningConflictError("Planning 状态输入无效")
        if result is not None:
            try:
                _canonical(result)
            except (TypeError, ValueError, RecursionError) as error:
                raise PlanningConflictError("Planning 状态结果格式/预算无效") from error
        async with self._transaction() as connection:
            if not await self._commitment_schema(connection):
                raise PlanningConflictError("Planning 状态源不存在")
            work = await self._evaluation_work(connection, feedback.job_id, feedback.scope_id, feedback.request_id)
            if work.plan.goal.goal_id != feedback.goal_id:
                raise PlanningConflictError("Planning 状态 goal 与真实来源冲突")
            has_evaluation = await self._evaluation_schema(connection)
            receipt = await self._evaluation_receipt(connection, feedback.job_id) if has_evaluation else None
            if feedback.status == "succeeded":
                expected = json.loads(_canonical(asdict(receipt))) if receipt is not None else None
                if receipt is None or result is None or not _matches_feedback_result(result, expected) \
                        or receipt.identity.attempt > feedback.attempt or receipt.identity.authority_epoch > feedback.job_epoch \
                        or receipt.identity.fencing_token > feedback.fencing_token \
                        or receipt.identity.attempt == feedback.attempt and (
                            receipt.identity.authority_epoch != feedback.job_epoch or receipt.identity.fencing_token != feedback.fencing_token):
                    raise PlanningConflictError("Planning 成功状态缺少匹配的持久评估 receipt")
            elif result is not None:
                raise PlanningConflictError("Planning 非成功状态不能自报业务结果")
            await self._feedback_schema(connection, create=True)
            high = int((await (await connection.execute(
                "SELECT value FROM planning_job_feedback_meta WHERE key='delivery_epoch'")).fetchone())[0])
            evaluation_epoch = await self._evaluation_epoch(connection) if has_evaluation else 0
            if feedback.delivery_epoch < max(high, evaluation_epoch) or feedback.job_epoch > feedback.delivery_epoch:
                raise PlanningConflictError("Planning 状态投递主已失效")
            prior = await (await connection.execute(
                "SELECT event_digest FROM planning_job_feedback_inbox WHERE event_id=?", (feedback.event_id,))).fetchone()
            if prior is not None and prior[0] != feedback.event_digest:
                raise PlanningConflictError("Planning 状态事件内容冲突")
            current = await (await connection.execute(
                "SELECT revision,job_epoch FROM planning_job_projection WHERE request_id=?", (feedback.request_id,))).fetchone()
            if current is not None and feedback.revision > current[0] and feedback.job_epoch < current[1]:
                raise PlanningConflictError("Planning 状态 authority 回退")
            await connection.execute("UPDATE planning_job_feedback_meta SET value=? WHERE key='delivery_epoch'", (str(feedback.delivery_epoch),))
            if prior is None:
                await connection.execute("INSERT INTO planning_job_feedback_inbox VALUES(?,?,?)", (
                    feedback.event_id, feedback.event_digest, feedback.request_id))
                # 取消/unknown 是执行意图/不确定性；投影保留真实已提交的评估，不改写承诺。
                await connection.execute("""INSERT INTO planning_job_projection VALUES(?,?,?,?,?,?,?,?)
                    ON CONFLICT(request_id) DO UPDATE SET revision=excluded.revision,job_epoch=excluded.job_epoch,
                    status=excluded.status,receipt_id=COALESCE(excluded.receipt_id,planning_job_projection.receipt_id),
                    updated_at=excluded.updated_at,business_outcome=CASE WHEN COALESCE(excluded.receipt_id,
                    planning_job_projection.receipt_id) IS NOT NULL THEN 'committed' ELSE 'unknown' END
                    WHERE excluded.revision>planning_job_projection.revision""", (
                    feedback.request_id, feedback.job_id, feedback.revision, feedback.job_epoch, feedback.status,
                    receipt.receipt_id if receipt else None, feedback.updated_at, "committed" if receipt else "unknown"))
            return prior is not None

    @staticmethod
    async def _feedback_schema(connection: aiosqlite.Connection, *, create: bool = False) -> bool:
        tables = {row[0] for row in await (await connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?,?)", _FEEDBACK_TABLES)).fetchall()}
        if not tables:
            if not create:
                return False
            if not await SqlitePlanningStore._commitment_schema(connection):
                raise PlanningConflictError("Planning 状态源不存在")
            for statement in _FEEDBACK_SCHEMA:
                await connection.execute(statement)
            await connection.executemany("INSERT INTO planning_job_feedback_meta VALUES(?,?)", [("schema_version", "1"), ("delivery_epoch", "0")])
            return True
        if tables != set(_FEEDBACK_TABLES) or not await SqlitePlanningStore._commitment_schema(connection):
            raise PlanningConflictError("Planning 状态接收库不完整；须受控恢复")
        values = dict(await (await connection.execute("SELECT key,value FROM planning_job_feedback_meta")).fetchall())
        if values.get("schema_version") != "1" or not re.fullmatch(r"0|[1-9][0-9]*", values.get("delivery_epoch", "")) \
                or int(values["delivery_epoch"]) > 2**53 - 1:
            raise PlanningConflictError("Planning 状态接收版本/authority 无效；须受控恢复")
        for statement in ("SELECT event_id,event_digest,request_id FROM planning_job_feedback_inbox LIMIT 0",
                          "SELECT request_id,job_id,revision,job_epoch,status,receipt_id,updated_at,business_outcome FROM planning_job_projection LIMIT 0"):
            await connection.execute(statement)
        return True

    @staticmethod
    async def _evaluation_row(connection: aiosqlite.Connection, identity: PlanningJobIdentity) -> aiosqlite.Row | None:
        return await (await connection.execute("SELECT * FROM planning_evaluation_attempt WHERE job_id=? AND attempt=?",
                                               (identity.job_id, identity.attempt))).fetchone()

    @staticmethod
    def _assert_evaluation_identity(row: aiosqlite.Row, identity: PlanningJobIdentity, request_id: str) -> None:
        if (row["scope_id"], row["authority_epoch"], row["fencing_token"], row["owner_id"], row["request_id"]) != (
            identity.scope_id, identity.authority_epoch, identity.fencing_token, identity.owner_id, request_id
        ):
            raise PlanningConflictError("Planning 原 attempt 身份冲突")

    async def _evaluation_time(self, connection: aiosqlite.Connection) -> int:
        row = await (await connection.execute("SELECT value FROM planning_evaluation_meta WHERE key='observed_at_ms'")).fetchone()
        now = max(self._clock_now(), int(row[0]))
        self._last_time = now
        await connection.execute("UPDATE planning_evaluation_meta SET value=? WHERE key='observed_at_ms'", (str(now),))
        return now

    @staticmethod
    async def _evaluation_epoch(connection: aiosqlite.Connection) -> int:
        row = await (await connection.execute("SELECT value FROM planning_evaluation_meta WHERE key='authority_epoch'")).fetchone()
        return int(row[0])

    @staticmethod
    async def _fence_evaluation(connection: aiosqlite.Connection, identity: PlanningJobIdentity, now: int) -> None:
        epoch = await SqlitePlanningStore._evaluation_epoch(connection)
        if identity.authority_epoch > epoch:
            await connection.execute("UPDATE planning_evaluation_meta SET value=? WHERE key='authority_epoch'", (str(identity.authority_epoch),))
            await connection.execute("UPDATE planning_evaluation_attempt SET state='sealed',observed_at=? WHERE state='active' AND authority_epoch<?",
                                     (now, identity.authority_epoch))
        await connection.execute("UPDATE planning_evaluation_attempt SET state='sealed',observed_at=? WHERE state='active' AND job_id=?",
                                 (now, identity.job_id))

    @staticmethod
    async def _assert_new_evaluation(connection: aiosqlite.Connection, identity: PlanningJobIdentity) -> None:
        row = await (await connection.execute("SELECT * FROM planning_evaluation_attempt WHERE job_id=? ORDER BY attempt DESC LIMIT 1",
                                              (identity.job_id,))).fetchone()
        if row is not None and (identity.scope_id != row["scope_id"] or identity.attempt <= row["attempt"]
                                or identity.fencing_token <= row["fencing_token"] or identity.authority_epoch < row["authority_epoch"]):
            raise PlanningConflictError("Planning attempt/token/epoch 不可倒退")

    @staticmethod
    async def _evaluation_receipt(connection: aiosqlite.Connection, job_id: str) -> PlanningEvaluationReceipt | None:
        row = await (await connection.execute("SELECT receipt_id,payload_json FROM planning_evaluation_receipt WHERE job_id=?", (job_id,))).fetchone()
        if row is None:
            return None
        try:
            if len(row["payload_json"].encode("utf-8")) > 65_536:
                raise ValueError("receipt budget")
            value = json.loads(row["payload_json"])
            if set(value) != {"receipt_id", "identity", "request_id", "commitment_id", "commitment_revision", "assessment", "evidence", "committed_at"}:
                raise ValueError("receipt fields")
            receipt = PlanningEvaluationReceipt(
                value["receipt_id"], PlanningJobIdentity(**value["identity"]), value["request_id"], value["commitment_id"],
                value["commitment_revision"], PlanningAssessment(**{**value["assessment"], "evidence_ids": tuple(value["assessment"]["evidence_ids"])}),
                tuple(PlanningEvidenceReference(**item) for item in value["evidence"]), value["committed_at"],
            )
            if (type(receipt.commitment_revision) is not int or not 1 <= receipt.commitment_revision <= 2**53 - 1
                or type(receipt.committed_at) is not int or not 0 <= receipt.committed_at <= 2**53 - 1
                or not isinstance(receipt.commitment_id, str) or not receipt.commitment_id.strip()
                or not isinstance(receipt.request_id, str) or not re.fullmatch(r"[a-f0-9]{64}", receipt.request_id)
                or len(receipt.evidence) > 64 or len({item.evidence_id for item in receipt.evidence}) != len(receipt.evidence)
                or any(item.scope_id != receipt.identity.scope_id for item in receipt.evidence)
                or not set(receipt.assessment.evidence_ids).issubset(item.evidence_id for item in receipt.evidence)):
                raise ValueError("receipt identity/evidence")
        except (ValueError, TypeError, KeyError, RecursionError) as error:
            raise PlanningConflictError("Planning receipt 结构/证据无效；须受控恢复") from error
        expected_id = hashlib.sha256(f"planning-evaluation.v1:{receipt.request_id}".encode()).hexdigest()
        if receipt.identity.job_id != job_id or row["receipt_id"] != receipt.receipt_id or receipt.receipt_id != expected_id:
            raise PlanningConflictError("Planning receipt 身份冲突；须受控恢复")
        return receipt

    async def prepare_evaluation(self, identity: PlanningJobIdentity, request_id: str) -> PlanningEvaluationWork | PlanningEvaluationReceipt:
        self._evaluation_identity(identity, request_id)
        result: PlanningEvaluationWork | PlanningEvaluationReceipt | None = None
        async with self._transaction() as connection:
            if not await self._commitment_schema(connection):
                raise PlanningConflictError("Planning 源不存在")
            work = await self._evaluation_work(connection, identity.job_id, identity.scope_id, request_id)
            await self._evaluation_schema(connection, create=True)
            now = await self._evaluation_time(connection)
            row = await self._evaluation_row(connection, identity)
            if row is not None:
                self._assert_evaluation_identity(row, identity, request_id)
            valid = identity.authority_epoch >= await self._evaluation_epoch(connection) and identity.lease_until > now
            if row is not None and row["state"] != "applied":
                valid = valid and row["state"] == "active" and row["lease_until"] > now
            if not valid:
                if row is not None and row["state"] == "active":
                    await connection.execute("UPDATE planning_evaluation_attempt SET state='sealed',observed_at=? WHERE job_id=? AND attempt=?",
                                             (now, identity.job_id, identity.attempt))
                elif row is None:
                    await self._assert_new_evaluation(connection, identity)
                    await self._fence_evaluation(connection, identity, now)
                    await connection.execute("INSERT INTO planning_evaluation_attempt VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (
                        identity.job_id, identity.attempt, identity.scope_id, identity.authority_epoch, identity.fencing_token,
                        identity.owner_id, identity.lease_until, request_id, None, "sealed", None, now,
                    ))
            else:
                receipt = await self._evaluation_receipt(connection, identity.job_id)
                digest = hashlib.sha256(_canonical(_work_document(work)).encode("utf-8")).hexdigest()
                if row is not None:
                    if row["state"] == "applied":
                        if receipt is None or receipt.receipt_id != row["receipt_id"]:
                            raise PlanningConflictError("Planning applied receipt 丢失")
                    elif row["work_digest"] != digest:
                        raise PlanningConflictError("Planning 原评估输入已改变")
                    await connection.execute("UPDATE planning_evaluation_attempt SET lease_until=MAX(lease_until,?) WHERE job_id=? AND attempt=?",
                                             (identity.lease_until, identity.job_id, identity.attempt))
                else:
                    await self._assert_new_evaluation(connection, identity)
                    if receipt is None and work.commitment.status != CommitmentStatus.ACCEPTED:
                        raise PlanningConflictError("Planning 承诺不可评估")
                    await self._fence_evaluation(connection, identity, now)
                    await connection.execute("INSERT INTO planning_evaluation_attempt VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (
                        identity.job_id, identity.attempt, identity.scope_id, identity.authority_epoch, identity.fencing_token,
                        identity.owner_id, identity.lease_until, request_id, digest, "applied" if receipt else "active",
                        receipt.receipt_id if receipt else None, now if receipt else None,
                    ))
                result = receipt or work
        if result is None:
            raise PlanningConflictError("Planning 原 attempt/authority/lease 已失效")
        return result

    async def commit_evaluation(self, identity: PlanningJobIdentity, work: PlanningEvaluationWork,
                                assessment: PlanningAssessment, evidence: tuple[PlanningEvidenceReference, ...]) -> PlanningEvaluationReceipt:
        self._evaluation_identity(identity, work.request_id)
        if (not isinstance(assessment, PlanningAssessment) or not isinstance(evidence, tuple) or len(evidence) > 64
            or any(not isinstance(item, PlanningEvidenceReference) or item.scope_id != identity.scope_id for item in evidence)
            or len({item.evidence_id for item in evidence}) != len(evidence)
            or not set(assessment.evidence_ids).issubset(item.evidence_id for item in evidence)):
            raise PlanningConflictError("Planning 评估/证据无效")
        digest = hashlib.sha256(_canonical(_work_document(work)).encode("utf-8")).hexdigest()
        async with self._transaction() as connection:
            if not await self._evaluation_schema(connection):
                raise PlanningConflictError("Planning attempt 未登记")
            current = await self._evaluation_work(connection, identity.job_id, identity.scope_id, work.request_id)
            row = await self._evaluation_row(connection, identity)
            if row is None:
                raise PlanningConflictError("Planning attempt 未登记")
            self._assert_evaluation_identity(row, identity, work.request_id)
            now = await self._evaluation_time(connection)
            if (row["state"] != "active" or row["work_digest"] != digest or current != work
                or row["authority_epoch"] != await self._evaluation_epoch(connection) or row["lease_until"] <= now
                or current.commitment.status != CommitmentStatus.ACCEPTED):
                raise PlanningConflictError("Planning 提交 fencing/lease/输入校验失败")
            receipt_id = hashlib.sha256(f"planning-evaluation.v1:{work.request_id}".encode()).hexdigest()
            receipt = PlanningEvaluationReceipt(receipt_id, identity, work.request_id, work.commitment.commitment_id,
                                                work.commitment.revision + 1, assessment, evidence, now)
            await connection.execute("INSERT INTO planning_evaluation_receipt VALUES(?,?,?)", (identity.job_id, receipt_id, _canonical(asdict(receipt))))
            cursor = await connection.execute("UPDATE planning_commitment SET status=?,revision=revision+1 WHERE commitment_id=? AND revision=? AND status='accepted'",
                                             ("completed" if assessment.completed else "accepted", work.commitment.commitment_id, work.commitment.revision))
            if cursor.rowcount != 1:
                raise PlanningConflictError("Planning 承诺 revision 冲突")
            if assessment.completed:
                await self._notification_schema(connection, create=True)
                notification = self._notification_request(work, receipt)
                await connection.execute("INSERT INTO planning_notification_outbox VALUES(?,?,?,?)", (
                    notification.notification_id, receipt_id, work.request_id, _canonical(asdict(notification)),
                ))
            # 所有业务写入（含通知）之后再采样 deadline；不能留下完成或孤立通知。
            cursor = await connection.execute("UPDATE planning_evaluation_attempt SET state='applied',receipt_id=?,observed_at=? "
                                             "WHERE job_id=? AND attempt=? AND state='active' AND lease_until>planning_now_ms()",
                                             (receipt_id, now, identity.job_id, identity.attempt))
            if cursor.rowcount != 1:
                raise PlanningConflictError("Planning 最终接纳 deadline 已失效")
            await connection.execute("UPDATE planning_evaluation_meta SET value=? WHERE key='observed_at_ms'", (str(self._last_time),))
            return receipt

    @staticmethod
    def _notification_request(work: PlanningEvaluationWork, receipt: PlanningEvaluationReceipt) -> PlanningNotificationRequest:
        goal = work.plan.goal
        return PlanningNotificationRequest(
            hashlib.sha256(f"planning-completion.v1:{receipt.receipt_id}".encode()).hexdigest(),
            receipt.receipt_id, receipt.identity.job_id, receipt.request_id, receipt.commitment_id,
            receipt.commitment_revision, goal.goal_id, goal.version, goal.scope_id,
            goal.source_moment_id, goal.source_digest, receipt.committed_at,
        )

    @staticmethod
    def _read_notification(row: aiosqlite.Row) -> PlanningNotificationRequest:
        try:
            value = row["payload_json"]
            if not isinstance(value, str) or len(value.encode("utf-8")) > 65_536:
                raise ValueError("notification budget")
            request = PlanningNotificationRequest(**json.loads(value))
            if (row["notification_id"], row["receipt_id"], row["request_id"]) != (
                request.notification_id, request.receipt_id, request.request_id,
            ) or _canonical(asdict(request)) != value:
                raise ValueError("notification columns")
            return request
        except (ValueError, TypeError, KeyError, RecursionError) as error:
            raise PlanningConflictError("Planning 通知结构/引用无效；须受控恢复") from error

    async def pending_notification_requests(
        self, *, limit: int = 64, after_notification_id: str | None = None,
    ) -> list[PlanningNotificationRequest]:
        if (type(limit) is not int or not 1 <= limit <= 1000 or after_notification_id is not None
            and (not isinstance(after_notification_id, str) or not re.fullmatch(r"[a-f0-9]{64}", after_notification_id))):
            raise PlanningConflictError("Planning 通知分页无效")
        async with self._transaction() as connection:
            if not await self._notification_schema(connection):
                return []
            delivered = await self._notification_delivery_schema(connection)
            rows = await (await connection.execute(
                "SELECT * FROM planning_notification_outbox WHERE notification_id>? ORDER BY notification_id LIMIT ?",
                (after_notification_id or "", limit),
            )).fetchall()
            result: list[PlanningNotificationRequest] = []
            # 已确认的原请求仍留存；分页前进越过它们，不让短页/空页隐藏后续待办。
            while rows:
                for row in rows:
                    request = self._read_notification(row)
                    confirmation = await self._notification_delivery(connection, request) if delivered else None
                    if confirmation is None:
                        result.append(request)
                        if len(result) == limit:
                            return result
                rows = await (await connection.execute(
                    "SELECT * FROM planning_notification_outbox WHERE notification_id>? ORDER BY notification_id LIMIT ?",
                    (rows[-1]["notification_id"], limit),
                )).fetchall()
            return result

    async def read_notification_work(self, request: PlanningNotificationRequest) -> PlanningNotificationWork:
        if not isinstance(request, PlanningNotificationRequest):
            raise PlanningConflictError("Planning 通知请求无效")
        async with self._transaction() as connection:
            return await self._notification_work(connection, request)

    async def _notification_work(self, connection: aiosqlite.Connection, request: PlanningNotificationRequest) -> PlanningNotificationWork:
        if not await self._notification_schema(connection):
            raise PlanningConflictError("Planning 通知不存在")
        row = await (await connection.execute(
            "SELECT * FROM planning_notification_outbox WHERE notification_id=?", (request.notification_id,),
        )).fetchone()
        if row is None or self._read_notification(row) != request:
            raise PlanningConflictError("Planning 原通知引用冲突")
        work = await self._evaluation_work(connection, request.job_id, request.scope_id, request.request_id)
        receipt = await self._evaluation_receipt(connection, request.job_id)
        goal_row = await (await connection.execute(
            "SELECT payload_json FROM planning_goal_version WHERE goal_id=? AND version=?",
            (work.plan.goal.goal_id, work.plan.goal.version),
        )).fetchone()
        if (receipt is None or not receipt.assessment.completed
            or receipt.request_id != work.request_id or receipt.commitment_id != work.commitment.commitment_id
            or receipt.identity.scope_id != work.plan.goal.scope_id
            or work.commitment.status != CommitmentStatus.COMPLETED
            or work.commitment.revision != receipt.commitment_revision
            or goal_row is None or goal_row[0] != _canonical(_goal_document(work.plan.goal))
            or self._notification_request(work, receipt) != request):
            raise PlanningConflictError("Planning 通知/完成事实已改变；不得投递")
        return PlanningNotificationWork(request, work.plan.goal, receipt)

    async def acknowledge_notification(self, request: PlanningNotificationRequest, delivery: PlanningNotificationDelivery) -> bool:
        if not isinstance(request, PlanningNotificationRequest) or not isinstance(delivery, PlanningNotificationDelivery):
            raise PlanningConflictError("Planning 通知确认类型无效")
        # 即使是进程内输入也按完整模型复验，不把被修改的对象当作可信确认。
        delivery = PlanningNotificationDelivery(**asdict(delivery))
        if delivery.notification_id != request.notification_id or request.source_moment_id is None:
            raise PlanningConflictError("Planning 通知确认引用冲突")
        payload = _canonical(asdict(delivery))
        async with self._transaction() as connection:
            await self._notification_work(connection, request)
            exists = await self._notification_delivery_schema(connection)
            original = await self._notification_delivery(connection, request) if exists else None
            if original is not None:
                if original.identity() != delivery.identity():
                    raise PlanningConflictError("Planning 通知原送达事实冲突")
                return False
            await self._notification_delivery_schema(connection, create=True)
            try:
                await connection.execute("INSERT INTO planning_notification_delivery_receipt VALUES(?,?,?,?)",
                    (request.notification_id, delivery.receipt_id, payload, self._clock_now()))
            except aiosqlite.IntegrityError as error:
                raise PlanningConflictError("Planning 通知回执已绑定其他通知") from error
            return True

    @staticmethod
    async def _notification_delivery(connection: aiosqlite.Connection, request: PlanningNotificationRequest) -> PlanningNotificationDelivery | None:
        row = await (await connection.execute(
            "SELECT * FROM planning_notification_delivery_receipt WHERE notification_id=?", (request.notification_id,),
        )).fetchone()
        if row is None:
            return None
        try:
            payload = json.loads(row["payload_json"])
            if _canonical(payload) != row["payload_json"]:
                raise ValueError("confirmation canonical form")
            receipt = PlanningNotificationDelivery(**payload)
            if (receipt.notification_id != request.notification_id or receipt.receipt_id != row["receipt_id"]
                or type(row["acknowledged_at_ms"]) is not int or not 0 <= row["acknowledged_at_ms"] <= 2**53 - 1):
                raise ValueError("confirmation binding")
            return receipt
        except (ValueError, TypeError, KeyError) as error:
            raise PlanningConflictError("Planning 通知确认事实损坏；须受控恢复") from error

    @staticmethod
    async def _notification_delivery_schema(connection: aiosqlite.Connection, *, create: bool = False) -> bool:
        rows = await (await connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?)", _NOTIFICATION_DELIVERY_TABLES,
        )).fetchall()
        tables = {row[0] for row in rows}
        if not tables:
            if not create:
                return False
            if not await SqlitePlanningStore._notification_schema(connection):
                raise PlanningConflictError("Planning 通知确认没有原通知 owner")
            for statement in _NOTIFICATION_DELIVERY_SCHEMA:
                await connection.execute(statement)
            await connection.execute("INSERT INTO planning_notification_delivery_meta VALUES('schema_version','1')")
            return True
        if tables != set(_NOTIFICATION_DELIVERY_TABLES) or not await SqlitePlanningStore._notification_schema(connection):
            raise PlanningConflictError("Planning 通知确认窗口不完整；须受控恢复")
        try:
            rows = await (await connection.execute("SELECT key,value FROM planning_notification_delivery_meta")).fetchall()
            if len(rows) != 1 or dict(rows) != {"schema_version": "1"}:
                raise PlanningConflictError("Planning 通知确认窗口版本无效；须受控恢复")
            await connection.execute("SELECT notification_id,receipt_id,payload_json,acknowledged_at_ms FROM planning_notification_delivery_receipt LIMIT 0")
        except aiosqlite.DatabaseError as error:
            raise PlanningConflictError("Planning 通知确认窗口结构无效；须受控恢复") from error
        return True

    @staticmethod
    async def _notification_schema(connection: aiosqlite.Connection, *, create: bool = False) -> bool:
        rows = await (await connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?)", _NOTIFICATION_TABLES,
        )).fetchall()
        tables = {row[0] for row in rows}
        if not tables:
            if not create:
                return False
            if not await SqlitePlanningStore._evaluation_schema(connection):
                raise PlanningConflictError("Planning 通知没有评估 owner")
            for statement in _NOTIFICATION_SCHEMA:
                await connection.execute(statement)
            await connection.execute("INSERT INTO planning_notification_meta VALUES('schema_version','1')")
            return True
        if tables != set(_NOTIFICATION_TABLES) or not await SqlitePlanningStore._evaluation_schema(connection):
            raise PlanningConflictError("Planning 通知库不完整；须受控恢复")
        try:
            values = dict(await (await connection.execute("SELECT key,value FROM planning_notification_meta")).fetchall())
            if values != {"schema_version": "1"}:
                raise PlanningConflictError("Planning 通知库版本无效；须受控恢复")
            await connection.execute("SELECT notification_id,receipt_id,request_id,payload_json FROM planning_notification_outbox LIMIT 0")
        except aiosqlite.DatabaseError as error:
            raise PlanningConflictError("Planning 通知库结构无效；须受控恢复") from error
        return True

    async def reconcile_evaluation(self, identity: PlanningJobIdentity, request_id: str) -> PlanningJobResult:
        self._evaluation_identity(identity, request_id)
        async with self._transaction() as connection:
            if not await self._commitment_schema(connection):
                raise PlanningConflictError("Planning 源不存在")
            await self._evaluation_work(connection, identity.job_id, identity.scope_id, request_id)
            await self._evaluation_schema(connection, create=True)
            now = await self._evaluation_time(connection)
            row = await self._evaluation_row(connection, identity)
            if row is not None:
                self._assert_evaluation_identity(row, identity, request_id)
                if row["state"] == "applied":
                    receipt = await self._evaluation_receipt(connection, identity.job_id)
                    if receipt is None or receipt.receipt_id != row["receipt_id"]:
                        raise PlanningConflictError("Planning applied receipt 丢失")
                    return PlanningJobResult(identity, receipt, True, row["observed_at"])
                observed = row["observed_at"] if row["state"] == "sealed" else now
                await connection.execute("UPDATE planning_evaluation_attempt SET state='sealed',observed_at=? WHERE job_id=? AND attempt=?",
                                         (observed, identity.job_id, identity.attempt))
                return PlanningJobResult(identity, None, True, observed)
            await self._assert_new_evaluation(connection, identity)
            await self._fence_evaluation(connection, identity, now)
            receipt = await self._evaluation_receipt(connection, identity.job_id)
            await connection.execute("INSERT INTO planning_evaluation_attempt VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (
                identity.job_id, identity.attempt, identity.scope_id, identity.authority_epoch, identity.fencing_token, identity.owner_id,
                identity.lease_until, request_id, None, "applied" if receipt else "sealed", receipt.receipt_id if receipt else None, now,
            ))
            return PlanningJobResult(identity, receipt, True, now)

    @staticmethod
    async def _evaluation_schema(connection: aiosqlite.Connection, *, create: bool = False) -> bool:
        rows = await (await connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?,?)", _EVALUATION_TABLES)).fetchall()
        tables = {row[0] for row in rows}
        if not tables:
            if not create:
                return False
            for statement in _EVALUATION_SCHEMA:
                await connection.execute(statement)
            await connection.executemany("INSERT INTO planning_evaluation_meta VALUES(?,?)",
                                         [("schema_version", "1"), ("authority_epoch", "0"), ("observed_at_ms", "0")])
            return True
        if tables != set(_EVALUATION_TABLES) or not await SqlitePlanningStore._commitment_schema(connection):
            raise PlanningConflictError("Planning 评估库不完整；须受控恢复")
        values = dict(await (await connection.execute("SELECT key,value FROM planning_evaluation_meta")).fetchall())
        if (values.get("schema_version") != "1" or any(not isinstance(values.get(key), str) or not re.fullmatch(r"0|[1-9][0-9]*", values[key])
            or int(values[key]) > 2**53 - 1 for key in ("authority_epoch", "observed_at_ms"))):
            raise PlanningConflictError("Planning 评估库版本/authority/时钟无效；须受控恢复")
        for statement in (
            "SELECT job_id,attempt,scope_id,authority_epoch,fencing_token,owner_id,lease_until,request_id,work_digest,state,receipt_id,observed_at FROM planning_evaluation_attempt LIMIT 0",
            "SELECT job_id,receipt_id,payload_json FROM planning_evaluation_receipt LIMIT 0",
        ):
            await connection.execute(statement)
        return True

    @staticmethod
    def _commitment(row: aiosqlite.Row) -> Commitment:
        return Commitment(
            row["commitment_id"],
            row["plan_id"],
            CommitmentStatus(row["status"]),
            row["revision"],
            row["plan_version"],
        )

    @staticmethod
    async def _persist_goal(
        connection: aiosqlite.Connection, goal: GoalVersion, payload: str
    ) -> None:
        cursor = await connection.execute(
            "SELECT payload_json FROM planning_goal_version WHERE goal_id=? AND version=?",
            (goal.goal_id, goal.version),
        )
        row = await cursor.fetchone()
        if row is not None:
            if row[0] != payload:
                raise PlanningConflictError("不可变目标版本内容冲突")
            return
        cursor = await connection.execute(
            "SELECT version,scope_id FROM planning_goal_version WHERE goal_id=? ORDER BY version DESC LIMIT 1",
            (goal.goal_id,),
        )
        latest = await cursor.fetchone()
        if (
            goal.version != (latest[0] + 1 if latest is not None else 1)
            or latest is not None
            and latest[1] != goal.scope_id
        ):
            raise PlanningConflictError("目标版本跳跃或 scope 变更")
        await connection.execute(
            "INSERT INTO planning_goal_version VALUES(?,?,?,?)",
            (goal.goal_id, goal.version, goal.scope_id, payload),
        )

    @staticmethod
    async def _persist_plan(
        connection: aiosqlite.Connection, plan: PlanVersion, payload: str
    ) -> None:
        cursor = await connection.execute(
            "SELECT payload_json FROM planning_plan_version WHERE plan_id=? AND version=?",
            (plan.plan_id, plan.version),
        )
        row = await cursor.fetchone()
        if row is not None:
            if row[0] != payload:
                raise PlanningConflictError("不可变计划版本内容冲突")
            return
        cursor = await connection.execute(
            "SELECT version,goal_id,goal_version FROM planning_plan_version WHERE plan_id=? ORDER BY version DESC LIMIT 1",
            (plan.plan_id,),
        )
        latest = await cursor.fetchone()
        if (
            plan.version != (latest[0] + 1 if latest is not None else 1)
            or latest is not None
            and (latest[1] != plan.goal.goal_id or latest[2] > plan.goal.version)
        ):
            raise PlanningConflictError("计划版本跳跃、目标替换或目标版本回退")
        await connection.execute(
            "INSERT INTO planning_plan_version VALUES(?,?,?,?,?)",
            (plan.plan_id, plan.version, plan.goal.goal_id, plan.goal.version, payload),
        )

    @staticmethod
    async def _commitment_schema(
        connection: aiosqlite.Connection, *, create: bool = False
    ) -> bool:
        cursor = await connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?,?,?,?)",
            _COMMITMENT_TABLES,
        )
        tables = {row[0] for row in await cursor.fetchall()}
        if not tables:
            if not create:
                return False
            for statement in _COMMITMENT_SCHEMA:
                await connection.execute(statement)
            await connection.execute(
                "INSERT INTO planning_long_term_meta VALUES('schema_version','1')"
            )
            return True
        if tables != set(_COMMITMENT_TABLES):
            raise PlanningConflictError("Planning 长期库结构不完整；须受控恢复")
        cursor = await connection.execute(
            "SELECT value FROM planning_long_term_meta WHERE key='schema_version'"
        )
        row = await cursor.fetchone()
        if row is None or row[0] != "1":
            raise PlanningConflictError("Planning 长期库版本不受支持；须受控迁移")
        for statement in (
            "SELECT goal_id,version,scope_id,payload_json FROM planning_goal_version LIMIT 0",
            "SELECT plan_id,version,goal_id,goal_version,payload_json FROM planning_plan_version LIMIT 0",
            "SELECT commitment_id,plan_id,plan_version,status,revision FROM planning_commitment LIMIT 0",
            "SELECT request_id,commitment_id,payload_json,accepted_job_id,accepted_revision FROM planning_job_outbox LIMIT 0",
        ):
            await connection.execute(statement)
        return True

    @asynccontextmanager
    async def _transaction(self) -> AsyncIterator[aiosqlite.Connection]:
        # 共享连接的 journal 与长期状态读写均串行；取消后等回滚结束才释放。
        async with self._connection_lock:
            connection = self._require_connection()
            try:
                await connection.execute("BEGIN IMMEDIATE")
                yield connection
                await connection.commit()
            except BaseException as error:
                rollback = await self._drain_cleanup(
                    asyncio.gather(connection.rollback(), return_exceptions=True)
                )
                if isinstance(rollback[0], BaseException):
                    self._connection = None
                    failures = [error, rollback[0]]
                    closing = await self._drain_cleanup(
                        asyncio.gather(connection.close(), return_exceptions=True)
                    )
                    if isinstance(closing[0], BaseException):
                        failures.append(closing[0])
                    raise BaseExceptionGroup(
                        "Planning 事务清理失败；连接已撤销", failures
                    ) from None
                raise

    @staticmethod
    async def _drain_cleanup[T](
        operation: Awaitable[T], *, propagate_cancel: bool = False
    ) -> T:
        cleanup = asyncio.ensure_future(operation)
        cancelled: asyncio.CancelledError | None = None
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError as error:
                cancelled = error
        result = cleanup.result()
        if propagate_cancel and cancelled is not None:
            raise cancelled
        return result

    def _require_connection(self) -> aiosqlite.Connection:
        if self._connection is None:
            raise RuntimeError("Planning store is not connected")
        return self._connection
