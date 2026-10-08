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
    PlanningJobIdentity,
    PlanningJobResult,
)
from glimmer_cradle.cognition.planning.goal import GoalVersion, PlanningAssessment
from glimmer_cradle.cognition.planning.plan import PlanVersion
from glimmer_cradle.cognition.planning.planning_store import (
    PlanningConflictError,
    PlanningDecisionSnapshot,
    PlanningEvaluationWork,
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
            _canonical(asdict(plan.goal)),
            _canonical(asdict(plan)),
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
    async def _evaluation_work(connection: aiosqlite.Connection, identity: PlanningJobIdentity, request_id: str) -> PlanningEvaluationWork:
        cursor = await connection.execute("SELECT * FROM planning_job_outbox WHERE request_id=?", (request_id,))
        source = await cursor.fetchone()
        if source is None or source["accepted_job_id"] != identity.job_id:
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
            or request.kind != "planning.evaluate" or request.scope_id != identity.scope_id or plan.goal.scope_id != identity.scope_id
            or request.goal_id != plan.goal.goal_id or request.payload != {
                "commitment_id": commitment.commitment_id, "plan_id": plan.plan_id,
                "plan_version": plan.version, "goal_version": plan.goal.version,
            }):
            raise PlanningConflictError("Planning 原来源/计划/scope 冲突")
        return PlanningEvaluationWork(request_id, commitment, plan)

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
            work = await self._evaluation_work(connection, identity, request_id)
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
                digest = hashlib.sha256(_canonical(asdict(work)).encode("utf-8")).hexdigest()
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
        digest = hashlib.sha256(_canonical(asdict(work)).encode("utf-8")).hexdigest()
        async with self._transaction() as connection:
            if not await self._evaluation_schema(connection):
                raise PlanningConflictError("Planning attempt 未登记")
            current = await self._evaluation_work(connection, identity, work.request_id)
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
            # SQLite 真正写入时再次采样 deadline；receipt、承诺、attempt 在同一事务接受。
            cursor = await connection.execute("UPDATE planning_evaluation_attempt SET state='applied',receipt_id=?,observed_at=? "
                                             "WHERE job_id=? AND attempt=? AND state='active' AND lease_until>planning_now_ms()",
                                             (receipt_id, now, identity.job_id, identity.attempt))
            if cursor.rowcount != 1:
                raise PlanningConflictError("Planning 最终接纳 deadline 已失效")
            await connection.execute("UPDATE planning_evaluation_meta SET value=? WHERE key='observed_at_ms'", (str(self._last_time),))
            return receipt

    async def reconcile_evaluation(self, identity: PlanningJobIdentity, request_id: str) -> PlanningJobResult:
        self._evaluation_identity(identity, request_id)
        async with self._transaction() as connection:
            if not await self._commitment_schema(connection):
                raise PlanningConflictError("Planning 源不存在")
            await self._evaluation_work(connection, identity, request_id)
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
