"""SQLite transaction boundary for versioned Cognition memory."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import sqlite3
import uuid
from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager, closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import aiosqlite
import numpy as np
from glimmer_cradle.cognition.memory import (
    ConsolidationJob,
    Episode,
    MemoryConsolidationConflictError,
    MemoryConsolidationInput,
    MemoryConsolidationReceipt,
    MemoryConsolidationRequest,
    MemoryJobIdentity,
    MemoryJobResult,
    RelationshipRecord,
)
from glimmer_cradle.cognition.memory.consolidation import consolidation_input
from glimmer_cradle.cognition.ports import LoggerPort
from glimmer_cradle.conversation import ConversationLogReaderPort, Moment, MomentKind

SCHEMA_VERSION = 6
_VECTOR_DTYPE = np.float32


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


class SqliteMemoryStore:
    """Own the SQLite connection shared by memory persistence projections."""

    def __init__(
        self,
        db_path: Path,
        *,
        migration_path: Path | None = None,
        logger: LoggerPort | None = None,
    ) -> None:
        self._db_path = db_path
        self._migration_path = migration_path or (
            Path(__file__).resolve().parents[5] / "migrations" / "002-memory.sql"
        )
        self._conn: aiosqlite.Connection | None = None
        self._logger = logger
        self._connection_lock = asyncio.Lock()

    async def connect(self) -> None:
        async with self._connection_lock:
            await self._connect()

    async def _connect(self) -> None:
        if self._conn is not None:
            return
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = aiosqlite.connect(str(self._db_path))
        try:
            await connection
            await connection.execute("PRAGMA journal_mode=WAL")
            await connection.execute("PRAGMA foreign_keys=ON")
            cursor = await connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'"
            )
            if await cursor.fetchone() is None:
                # executescript 本身不保证多个 DDL 原子；初始化也绑定一个明确事务。
                await connection.executescript("BEGIN IMMEDIATE;\n" + self._migration_path.read_text(encoding="utf-8"))
                await connection.execute(
                    "INSERT INTO schema_meta VALUES('schema_version', ?)",
                    (str(SCHEMA_VERSION),),
                )
                await connection.commit()
            else:
                cursor = await connection.execute(
                    "SELECT value FROM schema_meta WHERE key='schema_version'"
                )
                row = await cursor.fetchone()
                version = int(row[0]) if row is not None else 0
                if version != SCHEMA_VERSION:
                    raise RuntimeError("检测到非当前记忆架构数据库；须先执行受控数据迁移")
            await connection.execute("SELECT receipt_id,operation_id,request_digest,draft_digest FROM memory_consolidation_receipts LIMIT 0")
            await connection.execute("SELECT episode_id,episode_version,scope_id,input_digest,receipt_id FROM memory_consolidation_inputs LIMIT 0")
            await connection.execute("SELECT epoch FROM memory_job_authority LIMIT 0")
            await connection.execute("SELECT singleton,owner FROM memory_consolidation_dispatch LIMIT 0")
            await connection.execute("SELECT job_id,attempt,state,receipt_id,observed_at FROM memory_job_attempts LIMIT 0")
        except BaseException:
            await self._drain_cleanup(connection.close())
            raise
        self._conn = connection
        if self._logger is not None:
            self._logger.info(
                "记忆事实库已就绪",
                db_path=str(self._db_path),
                schema_version=SCHEMA_VERSION,
            )

    async def select_consolidation_dispatch(self, owner: str) -> None:
        """App 在启动维护前绑定装配；旧队列未完成不能迁出，外部绑定不能回退。"""
        if owner not in {"legacy", "external"}:
            raise ValueError("Memory consolidation dispatch 无效")
        async with self.transaction() as conn:
            cursor = await conn.execute("SELECT owner FROM memory_consolidation_dispatch WHERE singleton=1")
            selected = await cursor.fetchone()
            if selected is not None and selected[0] not in {"legacy", "external"}:
                raise MemoryConsolidationConflictError("Memory consolidation dispatch 持久记录无效")
            if selected is not None and selected[0] == "external" and owner != "external":
                raise MemoryConsolidationConflictError("Memory 已绑定外部 Jobs；禁止恢复旧巩固队列")
            if owner == "legacy":
                cursor = await conn.execute("SELECT 1 FROM memory_job_attempts LIMIT 1")
                if await cursor.fetchone() is not None:
                    raise MemoryConsolidationConflictError("Memory 已有外部 Jobs attempt；禁止恢复旧巩固队列")
            if owner == "external":
                cursor = await conn.execute("SELECT 1 FROM consolidation_jobs WHERE state<>'completed' LIMIT 1")
                if await cursor.fetchone() is not None:
                    raise MemoryConsolidationConflictError("旧巩固队列未完成；须先执行受控数据迁移")
            await conn.execute("INSERT INTO memory_consolidation_dispatch VALUES(1,?) "
                               "ON CONFLICT(singleton) DO UPDATE SET owner=excluded.owner", (owner,))

    async def close(self) -> None:
        async with self._connection_lock:
            connection, self._conn = self._conn, None
            if connection is not None:
                await self._drain_cleanup(connection.close(), propagate_cancel=True)

    @asynccontextmanager
    async def read(self) -> AsyncIterator[aiosqlite.Connection]:
        # 同连接读取能看到自身未提交写入；必须与完整写事务一起串行化。
        async with self._connection_lock:
            yield self.connection

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[aiosqlite.Connection]:
        async with self._connection_lock:
            conn = self.connection
            try:
                # BEGIN 也在取消保护范围：aiosqlite 已排队的 SQL 不随 await 取消撤销。
                await conn.execute("BEGIN IMMEDIATE")
                yield conn
                await conn.commit()
            except BaseException as error:
                try:
                    await self._drain_cleanup(conn.rollback())
                except BaseException as rollback_error:
                    # 回滚失败后的连接不再可信；不得向下个 reader 暴露半写事务。
                    self._conn = None
                    failures = [error, rollback_error]
                    try:
                        await self._drain_cleanup(conn.close())
                    except BaseException as close_error:
                        failures.append(close_error)
                    raise BaseExceptionGroup("Memory transaction 清理失败；连接已撤销", failures) from None
                raise

    @staticmethod
    async def _drain_cleanup(operation: Awaitable[None], *, propagate_cancel: bool = False) -> None:
        cleanup = asyncio.ensure_future(operation)
        cancelled: asyncio.CancelledError | None = None
        # 再次取消不能使连接在清理仍排队时被下一个 owner 复用。
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError as error:
                cancelled = error
                continue
        cleanup.result()
        if propagate_cancel and cancelled is not None:
            raise cancelled

    @property
    def connection(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("SqliteMemoryStore 尚未连接")
        return self._conn


class MemoryRepository:
    """版本化时间记忆仓库。"""

    def __init__(self, database: SqliteMemoryStore) -> None:
        self._db = database

    async def create_revision(
        self,
        *,
        memory_id: str | None,
        kind: str,
        content: str,
        summary: str,
        status: str,
        confidence: float,
        salience: float,
        actor_id: str | None,
        scene_id: str | None,
        conversation_id: str | None,
        continuity_id: str | None,
        recall_scope: str,
        disclosure_scope: str,
        attributes: dict[str, Any],
        evidence: list[dict[str, Any]],
        consolidation_id: str,
        valid_from: str | None = None,
    ) -> str:
        result = await self.create_revisions(
            [
                {
                    "memory_id": memory_id,
                    "kind": kind,
                    "content": content,
                    "summary": summary,
                    "status": status,
                    "confidence": confidence,
                    "salience": salience,
                    "actor_id": actor_id,
                    "scene_id": scene_id,
                    "conversation_id": conversation_id,
                    "continuity_id": continuity_id,
                    "recall_scope": recall_scope,
                    "disclosure_scope": disclosure_scope,
                    "attributes": attributes,
                    "evidence": evidence,
                    "consolidation_id": consolidation_id,
                    "valid_from": valid_from,
                }
            ]
        )
        return result[0]

    async def create_revisions(self, drafts: list[dict[str, Any]]) -> list[str]:
        async with self._db.transaction() as conn:
            result = [await self._create_revision(conn, draft) for draft in drafts]
        return result

    @staticmethod
    def _input_document(item: MemoryConsolidationInput) -> dict[str, Any]:
        if (not isinstance(item.episode_id, str) or not item.episode_id.strip()
            or not isinstance(item.scope_id, str) or not item.scope_id.strip()
            or type(item.episode_version) is not int or item.episode_version < 1
            or not isinstance(item.input_digest, str) or not re.fullmatch(r"[0-9a-f]{64}", item.input_digest)):
            raise MemoryConsolidationConflictError("Memory 巩固输入身份无效")
        return {"episode_id": item.episode_id, "episode_version": item.episode_version,
                "scope_id": item.scope_id, "input_digest": item.input_digest}

    @staticmethod
    def _digest(document: Any) -> str:
        return hashlib.sha256(json.dumps(document, sort_keys=True, ensure_ascii=False,
                                          separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()

    @staticmethod
    def _receipt(row: Any, *, duplicate: bool) -> MemoryConsolidationReceipt:
        return MemoryConsolidationReceipt(row[0], row[1], row[2], tuple(json.loads(row[3])), row[4], duplicate)

    async def find_consolidation(self, item: MemoryConsolidationInput) -> MemoryConsolidationReceipt | None:
        self._input_document(item)
        async with self._db.read() as conn:
            cursor = await conn.execute("""
                SELECT r.receipt_id,r.operation_id,r.scope_id,r.memory_ids_json,r.committed_at,i.scope_id,i.input_digest
                FROM memory_consolidation_inputs i JOIN memory_consolidation_receipts r ON r.receipt_id=i.receipt_id
                WHERE i.episode_id=? AND i.episode_version=?
                """, (item.episode_id, item.episode_version))
            row = await cursor.fetchone()
            if row is None:
                return None
            if row[5] != item.scope_id or row[6] != item.input_digest:
                raise MemoryConsolidationConflictError("Memory 巩固输入 scope/digest 冲突")
            return self._receipt(row, duplicate=True)

    async def commit_consolidation(
        self, operation_id: str, inputs: tuple[MemoryConsolidationInput, ...], drafts: list[dict[str, Any]],
        *, execution: MemoryJobIdentity | None = None,
    ) -> MemoryConsolidationReceipt:
        if not isinstance(operation_id, str) or not operation_id.strip() or not inputs:
            raise MemoryConsolidationConflictError("Memory 巩固 operation/input 不得为空")
        documents = sorted((self._input_document(item) for item in inputs),
                           key=lambda item: (item["episode_id"], item["episode_version"]))
        if len({(item.episode_id, item.episode_version) for item in inputs}) != len(inputs):
            raise MemoryConsolidationConflictError("Memory 巩固输入重复")
        scopes = {item.scope_id for item in inputs}
        if len(scopes) != 1:
            raise MemoryConsolidationConflictError("Memory 巩固不得跨 scope")
        scope_id = inputs[0].scope_id
        for draft in drafts:
            if (not isinstance(draft.get("memory_id"), str) or not draft["memory_id"].strip()
                or draft.get("consolidation_id") != operation_id):
                raise MemoryConsolidationConflictError("Memory 巩固修订必须绑定稳定 operation/memory identity")
        if len({draft["memory_id"] for draft in drafts}) != len(drafts):
            raise MemoryConsolidationConflictError("Memory 巩固批次不得重复修订同一 memory identity")
        request_digest, draft_digest = self._digest(documents), self._digest(drafts)
        async with self._db.transaction() as conn:
            if execution is not None:
                await self._assert_job_commit(conn, execution, operation_id, request_digest)
            cursor = await conn.execute("""
                SELECT receipt_id,operation_id,scope_id,memory_ids_json,committed_at,request_digest,draft_digest
                FROM memory_consolidation_receipts WHERE operation_id=?
                """, (operation_id,))
            row = await cursor.fetchone()
            if row is not None:
                if row[5] != request_digest or row[6] != draft_digest:
                    raise MemoryConsolidationConflictError("Memory 巩固 operation 内容冲突")
                if execution is not None:
                    await self._accept_job(conn, execution, row[0])
                return self._receipt(row, duplicate=True)
            for item in inputs:
                cursor = await conn.execute("SELECT receipt_id FROM memory_consolidation_inputs WHERE episode_id=? AND episode_version=?",
                                            (item.episode_id, item.episode_version))
                if await cursor.fetchone() is not None:
                    raise MemoryConsolidationConflictError("Memory Episode 已由其他 operation 确认；须先查询原结果")
            # 无 receipt 的旧写入不能通过 revision 去重伪装为本次完整提交。
            for draft in drafts:
                cursor = await conn.execute(
                    "SELECT revision_id FROM memory_revisions WHERE memory_id=? AND consolidation_id=?",
                    (draft["memory_id"], operation_id),
                )
                if await cursor.fetchone() is not None:
                    raise MemoryConsolidationConflictError("Memory 巩固修订存在但缺少原子 receipt；须先对账")
            memory_ids = [await self._create_revision(conn, draft) for draft in drafts]
            receipt_id, timestamp = uuid.uuid4().hex, _now_iso()
            await conn.execute("INSERT INTO memory_consolidation_receipts VALUES(?,?,?,?,?,?,?)",
                               (receipt_id, operation_id, scope_id, request_digest, draft_digest,
                                json.dumps(memory_ids), timestamp))
            await conn.executemany("INSERT INTO memory_consolidation_inputs VALUES(?,?,?,?,?)", [
                (item.episode_id, item.episode_version, item.scope_id, item.input_digest, receipt_id) for item in inputs
            ])
            if execution is not None:
                await self._accept_job(conn, execution, receipt_id)
            return MemoryConsolidationReceipt(receipt_id, operation_id, scope_id, tuple(memory_ids), timestamp)

    @staticmethod
    def _validate_job_identity(identity: MemoryJobIdentity) -> None:
        for value in (identity.job_id, identity.scope_id, identity.owner_id):
            if not isinstance(value, str) or not value.strip():
                raise MemoryConsolidationConflictError("Memory Job identity 无效")
        for value in (identity.attempt, identity.authority_epoch, identity.fencing_token, identity.lease_until):
            if type(value) is not int or not 0 < value <= 9007199254740991:
                raise MemoryConsolidationConflictError("Memory Job epoch/attempt/token/deadline 无效")

    @staticmethod
    def _assert_job_identity(row: Any, identity: MemoryJobIdentity) -> None:
        if tuple(row[:4]) != (identity.scope_id, identity.authority_epoch, identity.fencing_token, identity.owner_id):
            raise MemoryConsolidationConflictError("Memory Job 原 attempt identity 冲突")

    @staticmethod
    async def _job_row(conn: Any, identity: MemoryJobIdentity) -> Any:
        cursor = await conn.execute("""
            SELECT scope_id,authority_epoch,fencing_token,owner_id,lease_until,operation_id,request_digest,state,receipt_id,observed_at
            FROM memory_job_attempts WHERE job_id=? AND attempt=?
            """, (identity.job_id, identity.attempt))
        return await cursor.fetchone()

    @staticmethod
    async def _receipt_by_id(conn: Any, receipt_id: str) -> MemoryConsolidationReceipt:
        cursor = await conn.execute("""
            SELECT receipt_id,operation_id,scope_id,memory_ids_json,committed_at
            FROM memory_consolidation_receipts WHERE receipt_id=?
            """, (receipt_id,))
        row = await cursor.fetchone()
        if row is None:
            raise MemoryConsolidationConflictError("Memory Job receipt 丢失，不能证明未提交")
        return MemoryRepository._receipt(row, duplicate=True)

    async def prepare_job(self, identity: MemoryJobIdentity, operation_id: str,
                          inputs: tuple[MemoryConsolidationInput, ...]) -> MemoryConsolidationReceipt | None:
        self._validate_job_identity(identity)
        if not isinstance(operation_id, str) or not operation_id.strip() or not inputs:
            raise MemoryConsolidationConflictError("Memory Job operation/input 无效")
        documents = sorted((self._input_document(item) for item in inputs),
                           key=lambda item: (item["episode_id"], item["episode_version"]))
        if (any(item.scope_id != identity.scope_id for item in inputs)
            or len({(item.episode_id, item.episode_version) for item in inputs}) != len(inputs)):
            raise MemoryConsolidationConflictError("Memory Job 输入 scope/identity 冲突")
        digest = self._digest(documents)
        async with self._db.transaction() as conn:
            epoch = (await (await conn.execute("SELECT epoch FROM memory_job_authority")).fetchone())[0]
            if identity.authority_epoch < epoch or identity.lease_until <= _now_ms():
                raise MemoryConsolidationConflictError("Memory Job authority/lease 已失效")
            row = await self._job_row(conn, identity)
            if row is not None:
                self._assert_job_identity(row, identity)
                if row[7] == "sealed":
                    raise MemoryConsolidationConflictError("Memory Job 原 attempt 已封口")
                if row[5:7] != (operation_id, digest):
                    raise MemoryConsolidationConflictError("Memory Job 原 attempt 输入冲突")
                if row[7] == "applied":
                    return await self._receipt_by_id(conn, row[8])
                if row[4] <= _now_ms():
                    raise MemoryConsolidationConflictError("Memory Job 原 lease 已过期，不允许复活")
                await conn.execute("UPDATE memory_job_attempts SET lease_until=MAX(lease_until,?) WHERE job_id=? AND attempt=?",
                                   (identity.lease_until, identity.job_id, identity.attempt))
                return None
            cursor = await conn.execute("""
                SELECT attempt,scope_id,authority_epoch,fencing_token,operation_id,request_digest,receipt_id
                FROM memory_job_attempts WHERE job_id=? ORDER BY attempt DESC LIMIT 1
                """, (identity.job_id,))
            previous = await cursor.fetchone()
            if previous is not None:
                if (identity.attempt <= previous[0] or identity.fencing_token <= previous[3]
                    or identity.authority_epoch < previous[2] or identity.scope_id != previous[1]):
                    raise MemoryConsolidationConflictError("Memory Job 旧 attempt/fencing 不可登记")
                cursor = await conn.execute("SELECT operation_id,request_digest FROM memory_job_attempts WHERE job_id=? AND operation_id IS NOT NULL LIMIT 1",
                                            (identity.job_id,))
                original = await cursor.fetchone()
                if original is not None and original != (operation_id, digest):
                    raise MemoryConsolidationConflictError("Memory Job 跨 attempt 输入冲突")
            if identity.authority_epoch > epoch:
                await conn.execute("UPDATE memory_job_authority SET epoch=?", (identity.authority_epoch,))
                await conn.execute("UPDATE memory_job_attempts SET state='sealed',observed_at=? WHERE state='active' AND authority_epoch<?",
                                   (_now_ms(), identity.authority_epoch))
            await conn.execute("UPDATE memory_job_attempts SET state='sealed',observed_at=? WHERE job_id=? AND state='active'", (_now_ms(), identity.job_id))
            # 新 attempt 不重新执行同一 Job 已提交的业务结果。
            cursor = await conn.execute("SELECT receipt_id FROM memory_job_attempts WHERE job_id=? AND state='applied' LIMIT 1", (identity.job_id,))
            applied = await cursor.fetchone()
            receipt_id = applied[0] if applied is not None else None
            await conn.execute("INSERT INTO memory_job_attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (
                identity.job_id, identity.attempt, identity.scope_id, identity.authority_epoch, identity.fencing_token,
                identity.owner_id, identity.lease_until, operation_id, digest,
                "applied" if receipt_id is not None else "active", receipt_id, _now_ms() if receipt_id is not None else None,
            ))
            return await self._receipt_by_id(conn, receipt_id) if receipt_id is not None else None

    async def reconcile_job(self, identity: MemoryJobIdentity) -> MemoryJobResult:
        self._validate_job_identity(identity)
        async with self._db.transaction() as conn:
            row = await self._job_row(conn, identity)
            if row is None:
                cursor = await conn.execute("SELECT attempt,scope_id,authority_epoch,fencing_token FROM memory_job_attempts WHERE job_id=? ORDER BY attempt DESC LIMIT 1",
                                            (identity.job_id,))
                known = await cursor.fetchone()
                if known is not None:
                    if identity.scope_id != known[1]:
                        raise MemoryConsolidationConflictError("Memory Job 对账 scope 冲突")
                    if identity.attempt > known[0]:
                        if identity.authority_epoch < known[2] or identity.fencing_token <= known[3]:
                            raise MemoryConsolidationConflictError("Memory Job 对账 attempt/fencing 倒退")
                        await conn.execute("UPDATE memory_job_attempts SET state='sealed',observed_at=? WHERE job_id=? AND attempt<? AND state='active'",
                                           (_now_ms(), identity.job_id, identity.attempt))
                    elif identity.authority_epoch > known[2] or identity.fencing_token >= known[3]:
                        raise MemoryConsolidationConflictError("Memory Job 原 attempt 对账身份顺序冲突")
                # 空查询不是证明：同一提交锁下先持久拒绝原身份的未来执行。
                observed_at = _now_ms()
                await conn.execute("INSERT INTO memory_job_attempts VALUES(?,?,?,?,?,?,?,NULL,NULL,'sealed',NULL,?)", (
                    identity.job_id, identity.attempt, identity.scope_id, identity.authority_epoch,
                    identity.fencing_token, identity.owner_id, identity.lease_until, observed_at,
                ))
                return MemoryJobResult(identity, None, True, observed_at)
            self._assert_job_identity(row, identity)
            if row[7] == "applied":
                return MemoryJobResult(identity, await self._receipt_by_id(conn, row[8]), True, row[9])
            observed_at = row[9] if row[9] is not None else _now_ms()
            await conn.execute("UPDATE memory_job_attempts SET state='sealed',observed_at=? WHERE job_id=? AND attempt=?", (observed_at, identity.job_id, identity.attempt))
            return MemoryJobResult(identity, None, True, observed_at)

    async def _assert_job_commit(self, conn: Any, identity: MemoryJobIdentity, operation_id: str, digest: str) -> None:
        self._validate_job_identity(identity)
        row = await self._job_row(conn, identity)
        if row is None:
            raise MemoryConsolidationConflictError("Memory Job attempt 未登记")
        self._assert_job_identity(row, identity)
        epoch = (await (await conn.execute("SELECT epoch FROM memory_job_authority")).fetchone())[0]
        if (row[5:7] != (operation_id, digest) or row[7] != "active"
            or identity.authority_epoch != epoch or row[4] <= _now_ms()):
            raise MemoryConsolidationConflictError("Memory Job 提交 fencing/lease/输入校验失败")

    @staticmethod
    async def _accept_job(conn: Any, identity: MemoryJobIdentity, receipt_id: str) -> None:
        # SQLite 执行时再次判 deadline，不能仅依赖业务写入前的 Python 时钟采样。
        cursor = await conn.execute("""
            UPDATE memory_job_attempts SET state='applied',receipt_id=?,
            observed_at=CAST(ROUND((julianday('now')-2440587.5)*86400000) AS INTEGER) WHERE job_id=? AND attempt=?
            AND state='active' AND authority_epoch=(SELECT epoch FROM memory_job_authority)
            AND lease_until>CAST(ROUND((julianday('now')-2440587.5)*86400000) AS INTEGER)
            """, (receipt_id, identity.job_id, identity.attempt))
        if cursor.rowcount != 1:
            raise MemoryConsolidationConflictError("Memory Job 结果接纳 fencing/deadline 已失效")

    @staticmethod
    async def _create_revision(conn: Any, draft: dict[str, Any]) -> str:
        memory_id = draft.get("memory_id") or uuid.uuid4().hex
        consolidation_id = draft["consolidation_id"]
        cursor = await conn.execute(
            "SELECT revision_id FROM memory_revisions WHERE memory_id=? AND consolidation_id=?",
            (memory_id, consolidation_id),
        )
        if await cursor.fetchone() is not None:
            return memory_id

        revision_id = uuid.uuid4().hex
        timestamp = _now_iso()
        valid_from = draft.get("valid_from") or timestamp
        cursor = await conn.execute(
            "SELECT current_revision_id FROM memory_items WHERE memory_id=?",
            (memory_id,),
        )
        row = await cursor.fetchone()
        previous = row[0] if row else None
        if row is None:
            await conn.execute(
                "INSERT INTO memory_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    memory_id,
                    draft["kind"],
                    draft["status"],
                    draft.get("actor_id"),
                    draft.get("scene_id"),
                    draft.get("conversation_id"),
                    draft.get("continuity_id"),
                    draft["recall_scope"],
                    draft["disclosure_scope"],
                    draft["confidence"],
                    draft["salience"],
                    revision_id,
                    timestamp,
                    timestamp,
                ),
            )
        else:
            await conn.execute(
                "UPDATE memory_revisions SET valid_to=? WHERE revision_id=? AND valid_to IS NULL",
                (valid_from, previous),
            )
            await conn.execute(
                """
                UPDATE memory_items SET kind=?,status=?,actor_id=?,scene_id=?,conversation_id=?,
                  continuity_id=?,recall_scope=?,disclosure_scope=?,confidence=?,salience=?,
                  current_revision_id=?,updated_at=? WHERE memory_id=?
                """,
                (
                    draft["kind"],
                    draft["status"],
                    draft.get("actor_id"),
                    draft.get("scene_id"),
                    draft.get("conversation_id"),
                    draft.get("continuity_id"),
                    draft["recall_scope"],
                    draft["disclosure_scope"],
                    draft["confidence"],
                    draft["salience"],
                    revision_id,
                    timestamp,
                    memory_id,
                ),
            )
        await conn.execute(
            "INSERT INTO memory_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (
                revision_id,
                memory_id,
                draft["content"],
                draft["summary"],
                json.dumps(draft["attributes"], ensure_ascii=False),
                valid_from,
                None,
                timestamp,
                previous,
                consolidation_id,
                timestamp,
            ),
        )
        await conn.executemany(
            "INSERT INTO memory_evidence VALUES(?,?,?,?)",
            [
                (
                    revision_id,
                    item["moment_id"],
                    item.get("role", "support"),
                    json.dumps(item.get("source", {}), ensure_ascii=False),
                )
                for item in draft["evidence"]
            ],
        )
        return memory_id

    async def all_current(self) -> list[dict[str, Any]]:
        async with self._db.read() as conn:
            cursor = await conn.execute(
                """
                SELECT i.memory_id,i.kind,i.status,i.actor_id,i.scene_id,i.conversation_id,
                       i.continuity_id,i.recall_scope,i.disclosure_scope,i.confidence,i.salience,
                       i.created_at,i.updated_at,r.revision_id,r.content,r.summary,r.attributes_json,
                       r.valid_from,r.valid_to
                FROM memory_items i JOIN memory_revisions r ON r.revision_id=i.current_revision_id
                ORDER BY i.updated_at
                """
            )
            return [self._row(row) for row in await cursor.fetchall()]

    async def count(self) -> int:
        async with self._db.read() as conn:
            cursor = await conn.execute(
                "SELECT COUNT(*) FROM memory_items WHERE status IN ('active','disputed')"
            )
            row = await cursor.fetchone()
            return int(row[0]) if row else 0

    async def evidence_for(
        self, revision_id: str, *, limit: int = 3
    ) -> list[dict[str, Any]]:
        async with self._db.read() as conn:
            cursor = await conn.execute(
                "SELECT moment_id,evidence_role,source_json FROM memory_evidence WHERE revision_id=? LIMIT ?",
                (revision_id, limit),
            )
            return [
                {"moment_id": row[0], "role": row[1], "source": json.loads(row[2])}
                for row in await cursor.fetchall()
            ]

    @staticmethod
    def _row(row: Any) -> dict[str, Any]:
        return {
            "memory_id": row[0],
            "kind": row[1],
            "status": row[2],
            "actor_id": row[3],
            "scene_id": row[4],
            "conversation_id": row[5],
            "continuity_id": row[6],
            "recall_scope": row[7],
            "disclosure_scope": row[8],
            "confidence": row[9],
            "salience": row[10],
            "created_at": row[11],
            "updated_at": row[12],
            "revision_id": row[13],
            "content": row[14],
            "summary": row[15],
            "attributes": json.loads(row[16]),
            "valid_from": row[17],
            "valid_to": row[18],
        }


class VectorRepository:
    """Memory/Knowledge embedding 向量仓库。"""

    def __init__(self, database: SqliteMemoryStore) -> None:
        self._db = database

    async def upsert_vector(
        self,
        *,
        owner_kind: str,
        owner_id: str,
        model: str,
        vector: np.ndarray,
    ) -> None:
        vec = np.asarray(vector, dtype=_VECTOR_DTYPE).reshape(-1)
        async with self._db.transaction() as conn:
            await conn.execute(
                """
                INSERT INTO embedding (owner_kind, owner_id, model, dim, vector)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(owner_kind, owner_id) DO UPDATE SET
                    model=excluded.model, dim=excluded.dim, vector=excluded.vector,
                    updated_at=CURRENT_TIMESTAMP
                """,
                (owner_kind, owner_id, model, int(vec.shape[0]), vec.tobytes()),
            )

    async def get_vectors(self, owner_kind: str, model: str) -> dict[str, np.ndarray]:
        async with self._db.read() as conn:
            cursor = await conn.execute(
                "SELECT owner_id, vector FROM embedding WHERE owner_kind = ? AND model = ?",
                (owner_kind, model),
            )
            return {
                row[0]: np.frombuffer(row[1], dtype=_VECTOR_DTYPE)
                for row in await cursor.fetchall()
            }

    async def delete_vector(self, owner_kind: str, owner_id: str) -> None:
        async with self._db.transaction() as conn:
            await conn.execute(
                "DELETE FROM embedding WHERE owner_kind = ? AND owner_id = ?",
                (owner_kind, owner_id),
            )

    async def count(self, owner_kind: str) -> int:
        async with self._db.read() as conn:
            cursor = await conn.execute(
                "SELECT COUNT(1) FROM embedding WHERE owner_kind = ?", (owner_kind,)
            )
            row = await cursor.fetchone()
            return int(row[0]) if row else 0


class RelationshipRepository:
    """可审计关系计数与证据化关系理解仓库。"""

    def __init__(self, database: SqliteMemoryStore) -> None:
        self._db = database

    async def observe(
        self,
        actor_id: str,
        *,
        kind: str,
        evidence_moment_id: str,
        display_name: str | None = None,
    ) -> RelationshipRecord:
        if kind not in {"direct", "ambient", "reply"}:
            raise ValueError(f"未知关系观察类型: {kind}")
        if not evidence_moment_id:
            raise ValueError("关系观察必须携带 Moment 证据")
        now = _now_iso()
        direct = int(kind == "direct")
        ambient = int(kind == "ambient")
        replies = int(kind == "reply")
        async with self._db.transaction() as conn:
            cursor = await conn.execute(
                "SELECT 1 FROM relationship_observations WHERE moment_id=?",
                (evidence_moment_id,),
            )
            if await cursor.fetchone() is None:
                await conn.execute(
                    """
                    INSERT INTO relationship_actors VALUES(?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(actor_id) DO UPDATE SET
                      display_name=CASE WHEN excluded.display_name='' THEN relationship_actors.display_name ELSE excluded.display_name END,
                      last_seen_at=excluded.last_seen_at,
                      direct_interactions=relationship_actors.direct_interactions+excluded.direct_interactions,
                      ambient_observations=relationship_actors.ambient_observations+excluded.ambient_observations,
                      replies=relationship_actors.replies+excluded.replies,
                      updated_at=excluded.updated_at
                    """,
                    (
                        actor_id,
                        display_name or "",
                        now,
                        now,
                        direct,
                        ambient,
                        replies,
                        None,
                        now,
                    ),
                )
                await conn.execute(
                    "INSERT INTO relationship_observations VALUES(?,?,?,?)",
                    (evidence_moment_id, actor_id, kind, now),
                )
        record = await self.get(actor_id)
        assert record is not None
        return record

    async def revise(
        self,
        actor_id: str,
        *,
        summary: str,
        attributes: dict[str, Any],
        confidence: float,
        evidence_moment_ids: list[str],
        consolidation_id: str,
    ) -> str:
        if not evidence_moment_ids:
            raise ValueError("关系修订必须携带 Moment 证据")
        revision_id = uuid.uuid4().hex
        now = _now_iso()
        async with self._db.transaction() as conn:
            cursor = await conn.execute(
                "SELECT current_revision_id FROM relationship_actors WHERE actor_id=?",
                (actor_id,),
            )
            row = await cursor.fetchone()
            if row is None:
                raise ValueError(f"关系 actor 尚未观察: {actor_id}")
            if row[0]:
                await conn.execute(
                    "UPDATE relationship_revisions SET valid_to=? WHERE revision_id=?",
                    (now, row[0]),
                )
            await conn.execute(
                "INSERT INTO relationship_revisions VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    revision_id,
                    actor_id,
                    summary,
                    json.dumps(attributes, ensure_ascii=False),
                    confidence,
                    now,
                    None,
                    consolidation_id,
                    now,
                ),
            )
            await conn.executemany(
                "INSERT INTO relationship_evidence VALUES(?,?)",
                [(revision_id, item) for item in evidence_moment_ids],
            )
            await conn.execute(
                "UPDATE relationship_actors SET current_revision_id=?,updated_at=? WHERE actor_id=?",
                (revision_id, now, actor_id),
            )
        return revision_id

    async def get(self, actor_id: str) -> RelationshipRecord | None:
        async with self._db.read() as conn:
            return await self._get(conn, actor_id)

    @staticmethod
    async def _get(conn: aiosqlite.Connection, actor_id: str) -> RelationshipRecord | None:
        cursor = await conn.execute(
            """
            SELECT a.actor_id,a.display_name,a.first_seen_at,a.last_seen_at,
                   a.direct_interactions,a.ambient_observations,a.replies,
                   COALESCE(r.summary,''),COALESCE(r.attributes_json,'{}'),COALESCE(r.confidence,0)
            FROM relationship_actors a
            LEFT JOIN relationship_revisions r ON r.revision_id=a.current_revision_id
            WHERE a.actor_id=?
            """,
            (actor_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return RelationshipRecord(
            row[0],
            row[1],
            row[2],
            row[3],
            int(row[4]),
            int(row[5]),
            int(row[6]),
            row[7],
            json.loads(row[8]),
            float(row[9]),
        )

    async def all_recent(self, *, limit: int = 50) -> list[RelationshipRecord]:
        async with self._db.read() as conn:
            cursor = await conn.execute(
                "SELECT actor_id FROM relationship_actors ORDER BY last_seen_at DESC LIMIT ?",
                (limit,),
            )
            result = []
            for row in await cursor.fetchall():
                record = await self._get(conn, row[0])
                if record:
                    result.append(record)
            return result


class ConsolidationJobRepository:
    """长期记忆巩固任务的持久队列。"""

    def __init__(self, database: SqliteMemoryStore) -> None:
        self._db = database

    @staticmethod
    async def _assert_legacy_dispatch(conn: aiosqlite.Connection) -> None:
        cursor = await conn.execute("SELECT owner FROM memory_consolidation_dispatch WHERE singleton=1")
        selected = await cursor.fetchone()
        if selected is not None and selected[0] != "legacy":
            raise MemoryConsolidationConflictError("Memory 已绑定外部 Jobs；旧队列写入被撤销")

    async def recover_expired(self) -> None:
        async with self._db.transaction() as conn:
            await self._assert_legacy_dispatch(conn)
            await conn.execute(
                """
                UPDATE consolidation_jobs SET state='pending',lease_until=NULL
                WHERE state='claimed' AND lease_until<?
                """,
                (_now_iso(),),
            )

    async def enqueue(
        self, episode: Episode, *, debounce_seconds: int, max_wait_seconds: int
    ) -> None:
        now = datetime.now(timezone.utc)
        debounce_at = now + timedelta(seconds=debounce_seconds)
        deadline = _parse_iso(episode.started_at) + timedelta(seconds=max_wait_seconds)
        available_at = _iso(min(debounce_at, deadline))
        job_id = uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"glimmer:memory-job:{episode.episode_id}:{episode.version}",
        ).hex
        timestamp = _iso(now)
        async with self._db.transaction() as conn:
            await self._assert_legacy_dispatch(conn)
            await conn.execute(
                """
                INSERT INTO consolidation_jobs(
                  job_id,episode_id,episode_version,scene_id,actor_id,state,priority,
                  available_at,policy_version,created_at
                ) VALUES(?,?,?,?,?,'pending',?,?,?,?)
                ON CONFLICT(episode_id) DO UPDATE SET
                  episode_version=excluded.episode_version,
                  scene_id=excluded.scene_id,
                  actor_id=excluded.actor_id,
                  priority=MAX(consolidation_jobs.priority,excluded.priority),
                  available_at=MIN(consolidation_jobs.available_at,excluded.available_at),
                  state=CASE WHEN consolidation_jobs.state='completed' THEN 'completed' ELSE 'pending' END
                """,
                (
                    job_id,
                    episode.episode_id,
                    episode.version,
                    episode.scene_id,
                    episode.actor_id,
                    episode.salience,
                    available_at,
                    "memory-policy-v2",
                    timestamp,
                ),
            )

    async def claim_due(
        self, *, limit: int, lease_seconds: int
    ) -> list[ConsolidationJob]:
        now = datetime.now(timezone.utc)
        lease_until = _iso(now + timedelta(seconds=lease_seconds))
        async with self._db.transaction() as conn:
            await self._assert_legacy_dispatch(conn)
            cursor = await conn.execute(
                """
                SELECT job_id,episode_id,episode_version,scene_id,actor_id,attempt_count
                FROM consolidation_jobs
                WHERE state IN ('pending','failed') AND available_at<=?
                ORDER BY priority DESC,available_at LIMIT ?
                """,
                (_iso(now), limit),
            )
            rows = await cursor.fetchall()
            if rows:
                await conn.executemany(
                    """
                    UPDATE consolidation_jobs
                    SET state='claimed',lease_until=?,started_at=?,attempt_count=attempt_count+1,
                        error_code=NULL WHERE job_id=?
                    """,
                    [(lease_until, _iso(now), row[0]) for row in rows],
                )
        return [ConsolidationJob(*row) for row in rows]

    async def complete(self, jobs: list[ConsolidationJob]) -> None:
        if not jobs:
            return
        timestamp = _now_iso()
        async with self._db.transaction() as conn:
            await self._assert_legacy_dispatch(conn)
            cursor = await conn.executemany(
                """
                UPDATE consolidation_jobs
                SET state='completed',lease_until=NULL,completed_at=?,error_code=NULL
                WHERE job_id=? AND state='claimed' AND attempt_count=?
                """,
                [(timestamp, job.job_id, job.attempt_count + 1) for job in jobs],
            )
            if cursor.rowcount != len(jobs):
                raise MemoryConsolidationConflictError("旧巩固 claimed attempt 已失效")

    async def fail(
        self,
        jobs: list[ConsolidationJob],
        *,
        error_code: str,
        retry_base_seconds: int,
    ) -> None:
        if not jobs:
            return
        now = datetime.now(timezone.utc)
        values = []
        for job in jobs:
            delay = retry_base_seconds * (2 ** min(job.attempt_count, 6))
            values.append((_iso(now + timedelta(seconds=delay)), error_code, job.job_id, job.attempt_count + 1))
        async with self._db.transaction() as conn:
            await self._assert_legacy_dispatch(conn)
            await conn.executemany(
                """
                UPDATE consolidation_jobs
                SET state='failed',available_at=?,lease_until=NULL,error_code=? WHERE job_id=? AND state='claimed' AND attempt_count=?
                """,
                values,
            )


class RelationshipProjection:
    """从 Conversation Log 幂等派生关系互动计数。"""

    def __init__(
        self,
        *,
        recorder: ConversationLogReaderPort,
        repository: RelationshipRepository,
        database: SqliteMemoryStore,
    ) -> None:
        self._recorder = recorder
        self._repository = repository
        self._database = database

    async def project_pending(self) -> int:
        await self._recorder.flush()
        async with self._database.read() as conn:
            cursor = await conn.execute(
                "SELECT position FROM projection_checkpoints WHERE projection_name='relationship'"
            )
            row = await cursor.fetchone()
        checkpoint = int(row[0]) if row else 0
        moments = self._recorder.moments_after(checkpoint)
        for moment in moments:
            actor_id = moment.actor_id
            if actor_id and moment.kind == MomentKind.PERCEPTION.value:
                address_mode = str(moment.content.get("address_mode") or "ambient")
                await self._repository.observe(
                    actor_id,
                    kind="direct" if address_mode == "direct" else "ambient",
                    evidence_moment_id=moment.moment_id,
                    display_name=moment.actor_name,
                )
            elif actor_id and moment.kind == MomentKind.REPLY.value:
                await self._repository.observe(
                    actor_id,
                    kind="reply",
                    evidence_moment_id=moment.moment_id,
                    display_name=moment.actor_name,
                )
        if moments:
            async with self._database.transaction() as conn:
                await conn.execute(
                    """
                    INSERT INTO projection_checkpoints VALUES('relationship',?,?)
                    ON CONFLICT(projection_name) DO UPDATE SET
                      position=MAX(projection_checkpoints.position,excluded.position),updated_at=excluded.updated_at
                    """,
                    (moments[-1].seq, _now_iso()),
                )
        return len(moments)


class EpisodeProjection:
    """Episode 派生投影及其源请求；持久请求钉住原 Episode 身份。"""

    def __init__(
        self,
        db_path: Path,
        recorder: ConversationLogReaderPort,
        *,
        idle_seconds: int = 300,
        integrity_check: bool = True,
    ) -> None:
        self._path = db_path
        self._recorder = recorder
        self._idle_seconds = max(10, idle_seconds)
        self._integrity_check = integrity_check

    async def start(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self._path)) as conn:
            conn.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS projection_meta(
                  key TEXT PRIMARY KEY,value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS episodes(
                  episode_id TEXT PRIMARY KEY, version INTEGER NOT NULL,
                  interaction_id TEXT NOT NULL, scene_id TEXT NOT NULL,
                  conversation_id TEXT NOT NULL, recall_scope TEXT NOT NULL,
                  disclosure_scope TEXT NOT NULL, actor_id TEXT,
                  first_position INTEGER NOT NULL, last_position INTEGER NOT NULL,
                  started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
                  boundary_reason TEXT NOT NULL, salience REAL NOT NULL,
                  status TEXT NOT NULL, consolidated_at TEXT
                );
                DROP INDEX IF EXISTS idx_episode_interaction;
                CREATE INDEX IF NOT EXISTS idx_episode_open_interaction
                  ON episodes(
                    interaction_id,scene_id,conversation_id,
                    recall_scope,disclosure_scope,status
                  );
                CREATE TABLE IF NOT EXISTS episode_moments(
                  episode_id TEXT NOT NULL, moment_id TEXT NOT NULL UNIQUE,
                  position INTEGER NOT NULL, PRIMARY KEY(episode_id,moment_id)
                );
                CREATE INDEX IF NOT EXISTS idx_episode_status
                  ON episodes(status,last_position);
                CREATE TABLE IF NOT EXISTS memory_request_outbox(
                  request_id TEXT PRIMARY KEY,
                  episode_id TEXT NOT NULL REFERENCES episodes(episode_id),
                  episode_version INTEGER NOT NULL CHECK(episode_version>0),
                  scope_id TEXT NOT NULL, input_digest TEXT NOT NULL,
                  created_at TEXT NOT NULL, accepted_job_id TEXT, resolved_at TEXT,
                  UNIQUE(episode_id,episode_version)
                );
                CREATE INDEX IF NOT EXISTS idx_memory_request_pending
                  ON memory_request_outbox(accepted_job_id,resolved_at,created_at,request_id);
                """
            )
            columns = {
                str(row[1])
                for row in conn.execute("PRAGMA table_info(episodes)").fetchall()
            }
            required = {"conversation_id", "recall_scope", "disclosure_scope"}
            if not required.issubset(columns):
                raise RuntimeError("检测到旧 Episode 投影；开发阶段请删除后重建")
            if self._integrity_check:
                result = conn.execute("PRAGMA integrity_check").fetchone()
                if result is None or result[0] != "ok":
                    raise RuntimeError(f"Episode 投影完整性检查失败: {result}")
            conn.execute("BEGIN IMMEDIATE")
            # 旧投影只有可重扫的 sealed 待办；升级首次扫描补齐源请求，不重算已有身份。
            self._record_sealed_requests(conn)
            conn.commit()

    async def project_pending(self, *, seal: bool = False) -> int:
        await self._recorder.flush()
        with closing(sqlite3.connect(self._path)) as conn:
            row = conn.execute(
                "SELECT value FROM projection_meta WHERE key='position'"
            ).fetchone()
            checkpoint = int(row[0]) if row else 0
        moments = self._recorder.moments_after(checkpoint)
        if not moments:
            if seal:
                self._seal_open("forced")
            else:
                self._seal_idle()
            return 0
        with closing(sqlite3.connect(self._path)) as conn:
            conn.execute("BEGIN IMMEDIATE")
            for moment in moments:
                self._project_moment(conn, moment)
            conn.execute(
                """
                INSERT INTO projection_meta VALUES('position',?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value
                """,
                (str(moments[-1].seq),),
            )
            if seal:
                conn.execute(
                    """
                    UPDATE episodes SET status='sealed',boundary_reason='forced'
                    WHERE status='open'
                    """
                )
            else:
                self._seal_idle(conn)
            self._record_sealed_requests(conn)
            conn.commit()
        return len(moments)

    def pending_consolidation(self, *, limit: int = 8) -> list[Episode]:
        with closing(sqlite3.connect(self._path)) as conn:
            rows = conn.execute(
                """
                SELECT * FROM episodes
                WHERE status='sealed' AND consolidated_at IS NULL
                ORDER BY last_position LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [self._hydrate(conn, row) for row in rows]

    def get_episode(self, episode_id: str) -> Episode | None:
        with closing(sqlite3.connect(self._path)) as conn:
            row = conn.execute(
                "SELECT * FROM episodes WHERE episode_id=?", (episode_id,)
            ).fetchone()
            return self._hydrate(conn, row) if row is not None else None

    def recover_interrupted(self) -> None:
        self._seal_open("process_interrupted")

    def list_episodes(
        self, *, since_iso: str | None = None, limit: int = 100
    ) -> list[Episode]:
        with closing(sqlite3.connect(self._path)) as conn:
            if since_iso:
                rows = conn.execute(
                    """
                    SELECT * FROM episodes WHERE ended_at>=?
                    ORDER BY first_position DESC LIMIT ?
                    """,
                    (since_iso, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM episodes ORDER BY first_position DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            result = [self._hydrate(conn, row) for row in rows]
        return list(reversed(result))

    def mark_consolidated(self, episode_id: str, consolidated_at: str) -> None:
        with closing(sqlite3.connect(self._path)) as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                "UPDATE episodes SET consolidated_at=? WHERE episode_id=?",
                (consolidated_at, episode_id),
            )
            conn.execute(
                "UPDATE memory_request_outbox SET resolved_at=COALESCE(resolved_at,?) WHERE episode_id=?",
                (consolidated_at, episode_id),
            )
            conn.commit()

    def pending_job_requests(self, *, limit: int = 64) -> list[MemoryConsolidationRequest]:
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 1000:
            raise ValueError("Memory 源请求扫描上限无效")
        with closing(sqlite3.connect(self._path)) as conn:
            rows = conn.execute(
                """SELECT request_id,episode_id,episode_version,scope_id,input_digest,created_at
                FROM memory_request_outbox WHERE accepted_job_id IS NULL AND resolved_at IS NULL
                ORDER BY created_at,request_id LIMIT ?""", (limit,),
            ).fetchall()
        return [self._hydrate_request(row) for row in rows]

    def acknowledge_job_request(self, request: MemoryConsolidationRequest, job_id: str) -> None:
        if not isinstance(job_id, str) or not job_id.strip():
            raise MemoryConsolidationConflictError("Memory 源请求接纳 Job 身份无效")
        with closing(sqlite3.connect(self._path)) as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                """SELECT request_id,episode_id,episode_version,scope_id,input_digest,created_at,accepted_job_id
                FROM memory_request_outbox WHERE request_id=?""", (request.request_id,),
            ).fetchone()
            if row is None or self._hydrate_request(row) != request or row[6] not in (None, job_id):
                raise MemoryConsolidationConflictError("Memory 源请求接纳身份或 payload 冲突")
            conn.execute("UPDATE memory_request_outbox SET accepted_job_id=? WHERE request_id=?",
                         (job_id, request.request_id))
            conn.commit()

    @staticmethod
    def _hydrate_request(row: tuple[Any, ...]) -> MemoryConsolidationRequest:
        return MemoryConsolidationRequest(row[0], MemoryConsolidationInput(*row[1:5]), row[5])

    def _record_sealed_requests(self, conn: sqlite3.Connection) -> None:
        rows = conn.execute("""SELECT * FROM episodes AS episode
            WHERE status='sealed' AND consolidated_at IS NULL AND NOT EXISTS (
              SELECT 1 FROM memory_request_outbox AS request
              WHERE request.episode_id=episode.episode_id AND request.episode_version=episode.version
            )""").fetchall()
        for row in rows:
            episode = self._hydrate(conn, row)
            if len(episode.moments) != episode.version:
                raise MemoryConsolidationConflictError("Memory 源请求缺少已提交 Episode 证据")
            if not any(moment.retention_ceiling == "memory_candidate" for moment in episode.moments):
                continue
            item = consolidation_input(episode)
            identity = json.dumps([item.episode_id, item.episode_version, item.scope_id, item.input_digest],
                                  separators=(",", ":"))
            request_id = hashlib.sha256(identity.encode("utf-8")).hexdigest()
            conn.execute(
                "INSERT INTO memory_request_outbox VALUES(?,?,?,?,?,?,NULL,?)",
                (request_id, item.episode_id, item.episode_version, item.scope_id, item.input_digest,
                 _now_iso(), row[15]),
            )

    def rebuild(self) -> None:
        with closing(sqlite3.connect(self._path)) as conn:
            conn.execute("BEGIN IMMEDIATE")
            if conn.execute("SELECT 1 FROM memory_request_outbox LIMIT 1").fetchone() is not None:
                raise MemoryConsolidationConflictError("Episode 含持久源请求；必须保留原身份并经显式迁移重建")
            conn.execute("DELETE FROM episode_moments")
            conn.execute("DELETE FROM episodes")
            conn.execute("DELETE FROM projection_meta")
            conn.commit()

    def _project_moment(self, conn: sqlite3.Connection, moment: Moment) -> None:
        interaction_id = moment.interaction_id or moment.trace_id or moment.moment_id
        scene_id = moment.scene_id or ""
        row = conn.execute(
            """
            SELECT episode_id,version,first_position,salience FROM episodes
            WHERE interaction_id=? AND scene_id=? AND conversation_id=?
              AND recall_scope=? AND disclosure_scope=? AND status='open'
            ORDER BY last_position DESC LIMIT 1
            """,
            (
                interaction_id,
                scene_id,
                moment.conversation_id,
                moment.recall_scope,
                moment.disclosure_scope,
            ),
        ).fetchone()
        if row is None:
            episode_id = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO episodes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',NULL)",
                (
                    episode_id,
                    1,
                    interaction_id,
                    scene_id,
                    moment.conversation_id,
                    moment.recall_scope,
                    moment.disclosure_scope,
                    moment.actor_id,
                    moment.seq,
                    moment.seq,
                    moment.occurred_at,
                    moment.occurred_at,
                    "interaction",
                    moment.importance,
                ),
            )
        else:
            episode_id = row[0]
            count_row = conn.execute(
                "SELECT COUNT(*) FROM episode_moments WHERE episode_id=?",
                (episode_id,),
            ).fetchone()
            count = int(count_row[0]) if count_row else 0
            salience = (float(row[3]) * count + moment.importance) / (count + 1)
            conn.execute(
                """
                UPDATE episodes
                SET version=version+1,last_position=?,ended_at=?,salience=?
                WHERE episode_id=?
                """,
                (moment.seq, moment.occurred_at, salience, episode_id),
            )
        conn.execute(
            "INSERT INTO episode_moments VALUES(?,?,?)",
            (episode_id, moment.moment_id, moment.seq),
        )
        if moment.kind in {MomentKind.REPLY.value, MomentKind.SILENCE.value}:
            conn.execute(
                """
                UPDATE episodes
                SET status='sealed',boundary_reason='interaction_completed'
                WHERE episode_id=?
                """,
                (episode_id,),
            )

    def _seal_open(self, reason: str) -> None:
        with closing(sqlite3.connect(self._path)) as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                "UPDATE episodes SET status='sealed',boundary_reason=? WHERE status='open'",
                (reason,),
            )
            self._record_sealed_requests(conn)
            conn.commit()

    def _seal_idle(self, conn: sqlite3.Connection | None = None) -> None:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=self._idle_seconds)
        cutoff_iso = cutoff.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        if conn is not None:
            conn.execute(
                """
                UPDATE episodes SET status='sealed',boundary_reason='idle_timeout'
                WHERE status='open' AND ended_at<=?
                """,
                (cutoff_iso,),
            )
            return
        with closing(sqlite3.connect(self._path)) as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._seal_idle(connection)
            self._record_sealed_requests(connection)
            connection.commit()

    def _hydrate(self, conn: sqlite3.Connection, row: tuple[Any, ...]) -> Episode:
        positions = [
            item[0]
            for item in conn.execute(
                """
                SELECT position FROM episode_moments
                WHERE episode_id=? ORDER BY position
                """,
                (row[0],),
            )
        ]
        by_position = {
            item.seq: item
            for item in self._recorder.log.query(
                after_position=max(0, row[8] - 1),
                limit=row[9] - row[8] + 1,
            )
        }
        moments = tuple(
            by_position[position]
            for position in positions
            if position in by_position
        )
        return Episode(
            row[0],
            row[1],
            row[2],
            row[3],
            row[4],
            row[5],
            row[6],
            row[7],
            row[8],
            row[9],
            row[10],
            row[11],
            row[12],
            row[13],
            moments,
        )
