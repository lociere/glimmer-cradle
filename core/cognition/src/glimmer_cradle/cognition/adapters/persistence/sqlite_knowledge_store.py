"""Knowledge 独立 SQLite owner；正文修订与派生索引失效同事务提交。"""

from __future__ import annotations

import asyncio
import json
import re
import sqlite3
from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import aiosqlite
import numpy as np
from glimmer_cradle.cognition.knowledge.invalidation import require_authorized_source
from glimmer_cradle.cognition.knowledge.knowledge_store import KnowledgeConflictError
from glimmer_cradle.cognition.knowledge.revision import KnowledgeRevision
from glimmer_cradle.cognition.knowledge.transformation import content_digest

_APPLICATION_ID = 0x47434B4E
_SCHEMA_VERSION = 1
_TABLES = {"knowledge_entry", "knowledge_revision", "knowledge_embedding"}


class SqliteKnowledgeStore:
    def __init__(self, path: Path, *, migration_path: Path | None = None) -> None:
        self._path = path
        self._migration_path = migration_path or (
            Path(__file__).resolve().parents[5] / "migrations" / "003-knowledge.sql"
        )
        self._connection: aiosqlite.Connection | None = None
        self._connection_lock = asyncio.Lock()

    async def connect(self) -> None:
        async with self._connection_lock:
            if self._connection is not None:
                return
            self._path.parent.mkdir(parents=True, exist_ok=True)
            connection = aiosqlite.connect(self._path)
            try:
                await connection
                await connection.execute("PRAGMA foreign_keys=ON")
                # 初始化判定和 DDL 共用跨连接写锁，不能让两个首次启动 owner 同时创建。
                await connection.execute("BEGIN IMMEDIATE")
                cursor = await connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                )
                tables = {row[0] for row in await cursor.fetchall()}
                cursor = await connection.execute("PRAGMA application_id")
                owner = (await cursor.fetchone())[0]
                cursor = await connection.execute("PRAGMA user_version")
                version = (await cursor.fetchone())[0]
                if not tables and owner == version == 0:
                    statement = ""
                    for line in self._migration_path.read_text(
                        encoding="utf-8"
                    ).splitlines():
                        statement += line + "\n"
                        if sqlite3.complete_statement(statement):
                            # executescript 会隐式提交已有事务，不能用于 owner 判定后的初始化。
                            await connection.execute(statement)
                            statement = ""
                    if statement.strip():
                        raise KnowledgeConflictError("Knowledge 初始化 SQL 不完整")
                await self._verify_schema(connection)
                await connection.commit()
            except BaseException:
                await self._drain_cleanup(connection.close())
                raise
            self._connection = connection

    @staticmethod
    async def _verify_schema(connection: aiosqlite.Connection) -> None:
        cursor = await connection.execute("PRAGMA application_id")
        owner = (await cursor.fetchone())[0]
        cursor = await connection.execute("PRAGMA user_version")
        version = (await cursor.fetchone())[0]
        cursor = await connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        tables = {row[0] for row in await cursor.fetchall()}
        if owner != _APPLICATION_ID or version != _SCHEMA_VERSION or tables != _TABLES:
            raise KnowledgeConflictError(
                "Knowledge 库 owner/schema 不受支持；须受控迁移或恢复"
            )
        try:
            for statement in (
                "SELECT entry_id,revision,content,content_digest,priority,enabled,scope,source,activation_json,deleted_at FROM knowledge_entry LIMIT 0",
                "SELECT entry_id,revision,content,content_digest,priority,enabled,source,deleted FROM knowledge_revision LIMIT 0",
                "SELECT owner_id,model,entry_revision,content_digest,transformation_version,dim,vector FROM knowledge_embedding LIMIT 0",
            ):
                await connection.execute(statement)
        except aiosqlite.DatabaseError as error:
            raise KnowledgeConflictError(
                "Knowledge 库结构不完整；须受控恢复"
            ) from error

    async def close(self) -> None:
        async with self._connection_lock:
            connection, self._connection = self._connection, None
            if connection is not None:
                await self._drain_cleanup(connection.close(), propagate_cancel=True)

    async def replace_config_entries(self, entries: list[dict[str, Any]]) -> None:
        require_authorized_source("config")
        incoming: dict[str, tuple[str, str, int, int]] = {}
        for item in entries:
            entry_id, content = item.get("entry_id"), item.get("content")
            priority, enabled = item.get("priority", 1), item.get("enabled", True)
            if (
                not isinstance(entry_id, str)
                or not entry_id.strip()
                or not isinstance(content, str)
                or not content.strip()
                or type(priority) is not int
                or not 1 <= priority <= 2**53 - 1
                or type(enabled) is not bool
                or entry_id in incoming
            ):
                raise KnowledgeConflictError("Knowledge 配置条目非法或身份重复")
            incoming[entry_id] = (
                content.strip(),
                content_digest(content),
                priority,
                int(enabled),
            )

        async with self._transaction() as connection:
            # 必须在写事务中读取修订；另一连接不能在快照和写入之间抢先提交。
            cursor = await connection.execute(
                "SELECT entry_id,revision,content,content_digest,priority,enabled,deleted_at,source FROM knowledge_entry"
            )
            existing = {row[0]: row for row in await cursor.fetchall()}
            for entry_id, (content, digest, priority, enabled) in incoming.items():
                row = existing.get(entry_id)
                if row is not None and row[7] != "config":
                    raise KnowledgeConflictError("配置不能覆盖另一 Knowledge 来源")
                if row and row[3:6] == (digest, priority, enabled) and row[6] is None:
                    continue
                await self._write_revision(
                    connection,
                    entry_id=entry_id,
                    revision=int(row[1]) + 1 if row else 1,
                    content=content,
                    digest=digest,
                    priority=priority,
                    enabled=enabled,
                    source="config",
                    owner_source="config",
                    deleted=0,
                )
            for entry_id, row in existing.items():
                if row[7] != "config" or entry_id in incoming or row[6] is not None:
                    continue
                await self._write_revision(
                    connection,
                    entry_id=entry_id,
                    revision=int(row[1]) + 1,
                    content=row[2],
                    digest=row[3],
                    priority=row[4],
                    enabled=0,
                    source="config",
                    owner_source="config",
                    deleted=1,
                )

    async def delete_entry(
        self, entry_id: str, *, expected_revision: int, source: str
    ) -> int:
        require_authorized_source(source)
        if type(expected_revision) is not int or not 1 <= expected_revision < 2**53 - 1:
            raise KnowledgeConflictError("Knowledge revision conflict")
        async with self._transaction() as connection:
            cursor = await connection.execute(
                "SELECT revision,content,content_digest,priority,source FROM knowledge_entry "
                "WHERE entry_id=? AND deleted_at IS NULL",
                (entry_id,),
            )
            row = await cursor.fetchone()
            if row is None:
                raise KeyError(entry_id)
            if row[0] != expected_revision:
                raise KnowledgeConflictError("Knowledge revision conflict")
            revision = expected_revision + 1
            await self._write_revision(
                connection,
                entry_id=entry_id,
                revision=revision,
                content=row[1],
                digest=row[2],
                priority=row[3],
                enabled=0,
                source=source,
                owner_source=row[4],
                deleted=1,
            )
            return revision

    async def get_all_entries(self) -> list[dict[str, Any]]:
        async with self._connection_lock:
            cursor = await self._conn.execute(
                "SELECT entry_id,content,priority,enabled,scope,source,activation_json,revision,content_digest "
                "FROM knowledge_entry WHERE deleted_at IS NULL ORDER BY priority DESC,entry_id"
            )
            return [
                {
                    "entry_id": row[0],
                    "content": row[1],
                    "priority": row[2],
                    "enabled": bool(row[3]),
                    "scope": row[4],
                    "source": row[5],
                    "activation": json.loads(row[6]),
                    "revision": row[7],
                    "content_digest": row[8],
                }
                for row in await cursor.fetchall()
            ]

    async def get_embeddings(
        self, *, model: str, transformation_version: str
    ) -> dict[KnowledgeRevision, np.ndarray]:
        self._validate_index_identity(model, transformation_version)
        async with self._connection_lock:
            cursor = await self._conn.execute(
                "SELECT v.owner_id,v.entry_revision,e.source,v.content_digest,v.dim,v.vector "
                "FROM knowledge_embedding v JOIN knowledge_entry e ON e.entry_id=v.owner_id "
                "AND e.revision=v.entry_revision AND e.content_digest=v.content_digest "
                "WHERE v.model=? AND v.transformation_version=? AND e.enabled=1 AND e.deleted_at IS NULL",
                (model, transformation_version),
            )
            result = {}
            for row in await cursor.fetchall():
                dimension, data = row[4], row[5]
                if (
                    type(dimension) is not int
                    or not 1 <= dimension <= 65_536
                    or len(data) != dimension * 4
                ):
                    raise KnowledgeConflictError("Knowledge 派生向量长度损坏")
                vector = np.frombuffer(data, dtype=np.float32).copy()
                if not np.isfinite(vector).all():
                    raise KnowledgeConflictError("Knowledge 派生向量非有限")
                result[KnowledgeRevision(row[0], row[1], row[2], row[3])] = vector
            return result

    async def upsert_embedding(
        self,
        reference: KnowledgeRevision,
        *,
        model: str,
        transformation_version: str,
        vector: np.ndarray,
    ) -> None:
        self._validate_index_identity(model, transformation_version)
        if (
            not isinstance(reference, KnowledgeRevision)
            or type(reference.revision) is not int
            or not 1 <= reference.revision <= 2**53 - 1
            or not isinstance(reference.content_digest, str)
            or not re.fullmatch(r"[0-9a-f]{64}", reference.content_digest)
        ):
            raise KnowledgeConflictError("Knowledge 向量修订引用非法")
        candidate = np.asarray(vector)
        if (
            candidate.ndim != 1
            or not 1 <= candidate.size <= 65_536
            or not np.issubdtype(candidate.dtype, np.number)
            or np.iscomplexobj(candidate)
        ):
            raise KnowledgeConflictError("Knowledge 向量维度非法")
        normalized = np.asarray(candidate, dtype=np.float32)
        if not np.isfinite(normalized).all():
            raise KnowledgeConflictError("Knowledge 向量非有限")

        async with self._transaction() as connection:
            cursor = await connection.execute(
                "SELECT revision,content_digest,source,enabled,deleted_at FROM knowledge_entry WHERE entry_id=?",
                (reference.entry_id,),
            )
            row = await cursor.fetchone()
            if (
                row is None
                or row[:3]
                != (reference.revision, reference.content_digest, reference.source)
                or not row[3]
                or row[4] is not None
            ):
                raise KnowledgeConflictError("Knowledge 向量来源修订已失效")
            cursor = await connection.execute(
                "SELECT dim FROM knowledge_embedding WHERE model=? AND transformation_version=? AND dim<>? LIMIT 1",
                (model, transformation_version, int(normalized.size)),
            )
            if await cursor.fetchone() is not None:
                raise KnowledgeConflictError("Knowledge 同一索引模型的向量维度冲突")
            await connection.execute(
                "INSERT INTO knowledge_embedding(owner_id,model,entry_revision,content_digest,transformation_version,dim,vector) "
                "VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id,model) DO UPDATE SET "
                "entry_revision=excluded.entry_revision,content_digest=excluded.content_digest,"
                "transformation_version=excluded.transformation_version,dim=excluded.dim,"
                "vector=excluded.vector,updated_at=CURRENT_TIMESTAMP",
                (
                    reference.entry_id,
                    model,
                    reference.revision,
                    reference.content_digest,
                    transformation_version,
                    int(normalized.size),
                    normalized.tobytes(),
                ),
            )

    @staticmethod
    def _validate_index_identity(model: str, transformation_version: str) -> None:
        if (
            not isinstance(model, str)
            or not model.strip()
            or not isinstance(transformation_version, str)
            or not transformation_version.strip()
        ):
            raise KnowledgeConflictError("Knowledge 模型或转换版本为空")

    @staticmethod
    async def _write_revision(
        connection: aiosqlite.Connection,
        *,
        entry_id: str,
        revision: int,
        content: str,
        digest: str,
        priority: int,
        enabled: int,
        source: str,
        owner_source: str,
        deleted: int,
    ) -> None:
        await connection.execute(
            "INSERT INTO knowledge_revision(entry_id,revision,content,content_digest,priority,enabled,source,deleted) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (entry_id, revision, content, digest, priority, enabled, source, deleted),
        )
        await connection.execute(
            "INSERT INTO knowledge_entry(entry_id,revision,content,content_digest,priority,enabled,scope,source,activation_json,deleted_at) "
            "VALUES(?,?,?,?,?,?,'knowledge',?,'{}',CASE WHEN ? THEN CURRENT_TIMESTAMP END) "
            "ON CONFLICT(entry_id) DO UPDATE SET revision=excluded.revision,content=excluded.content,"
            "content_digest=excluded.content_digest,priority=excluded.priority,enabled=excluded.enabled,"
            "source=excluded.source,deleted_at=excluded.deleted_at,updated_at=CURRENT_TIMESTAMP",
            (
                entry_id,
                revision,
                content,
                digest,
                priority,
                enabled,
                owner_source,
                deleted,
            ),
        )
        # 索引是派生状态；优先级/权限/正文修订与失效必须同事务，不能留下旧向量待后台补偿。
        await connection.execute(
            "DELETE FROM knowledge_embedding WHERE owner_id=?", (entry_id,)
        )

    @asynccontextmanager
    async def _transaction(self) -> AsyncIterator[aiosqlite.Connection]:
        async with self._connection_lock:
            connection = self._conn
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
                    closing = await self._drain_cleanup(
                        asyncio.gather(connection.close(), return_exceptions=True)
                    )
                    failures = [error, rollback[0]]
                    if isinstance(closing[0], BaseException):
                        failures.append(closing[0])
                    raise BaseExceptionGroup(
                        "Knowledge 事务清理失败；连接已撤销", failures
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

    @property
    def _conn(self) -> aiosqlite.Connection:
        if self._connection is None:
            raise RuntimeError("Knowledge store is not connected")
        return self._connection
