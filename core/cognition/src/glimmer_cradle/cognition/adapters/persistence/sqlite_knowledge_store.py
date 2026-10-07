"""Knowledge 独立 SQLite owner；正文修订与派生索引失效同事务提交。"""

from __future__ import annotations

import asyncio
import json
import re
import sqlite3
from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager, closing
from dataclasses import asdict
from pathlib import Path
from typing import Any

import aiosqlite
import numpy as np
from glimmer_cradle.cognition.knowledge.ingestion import resource_capture_from
from glimmer_cradle.cognition.knowledge.invalidation import require_authorized_source
from glimmer_cradle.cognition.knowledge.knowledge_store import KnowledgeConflictError
from glimmer_cradle.cognition.knowledge.revision import KnowledgeRevision
from glimmer_cradle.cognition.knowledge.source import (
    KnowledgeResourceCapture,
    KnowledgeResourceSource,
)
from glimmer_cradle.cognition.knowledge.transformation import content_digest
from glimmer_cradle.cognition.ports.resource_port import (
    ResourceAccess,
    ResourceScope,
    ResourceSnapshot,
)

_APPLICATION_ID = 0x47434B4E
_SCHEMA_VERSION = 2
_V1_TABLES = {"knowledge_entry", "knowledge_revision", "knowledge_embedding"}
_TABLES = _V1_TABLES | {"knowledge_resource_source", "knowledge_resource_revision"}


def _source_from_json(value: str) -> KnowledgeResourceSource:
    data = json.loads(value)
    return KnowledgeResourceSource(**{**data, "scope": ResourceScope(**data["scope"])})


def _capture_from_row(row: tuple) -> KnowledgeResourceCapture:
    data = json.loads(row[0])
    source = _source_from_json(json.dumps(data.pop("source")))
    snapshot = ResourceSnapshot(**{**data, "content": row[1], "access": ResourceAccess(**data["access"])})
    capture = resource_capture_from(source, snapshot)
    if (capture.parser_version, capture.chunk_version) != row[2:4]:
        raise KnowledgeConflictError("Knowledge Resource 转换版本不受支持")
    return capture


def _capture_json(capture: KnowledgeResourceCapture) -> str:
    snapshot = asdict(capture.snapshot)
    snapshot.pop("content")
    snapshot["source"] = asdict(capture.source)
    return json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class SqliteKnowledgeStore:
    def __init__(self, path: Path, *, migration_path: Path | None = None) -> None:
        self._path = path
        self._migration_path = migration_path or (
            Path(__file__).resolve().parents[5] / "migrations" / "003-knowledge.sql"
        )
        self._connection: aiosqlite.Connection | None = None
        self._connection_lock = asyncio.Lock()

    async def migrate_v1(self, *, backup_path: Path) -> None:
        """仅供停止 Worker 后的显式迁移；保留完整原库备份，不在 connect 中调用。"""
        async with self._connection_lock:
            if self._connection is not None:
                raise KnowledgeConflictError("Knowledge 迁移前须关闭 owner")
            await self._drain_cleanup(asyncio.to_thread(self._migrate_v1, backup_path), propagate_cancel=True)

    def _migrate_v1(self, backup_path: Path) -> None:
        if backup_path.resolve() == self._path.resolve() or backup_path.exists():
            raise KnowledgeConflictError("Knowledge backup 必须是新的独立路径")
        # mode=rw 防止将缺失原库误建为空库；写锁期间独立只读连接获取一致备份。
        with closing(sqlite3.connect(self._path.resolve().as_uri() + "?mode=rw", uri=True)) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
            if connection.execute("PRAGMA application_id").fetchone()[0] != _APPLICATION_ID \
                    or connection.execute("PRAGMA user_version").fetchone()[0] != 1 or tables != _V1_TABLES:
                raise KnowledgeConflictError("Knowledge 迁移仅接受完整 v1 owner")
            for statement in (
                "SELECT entry_id,revision,content,content_digest,priority,enabled,scope,source,activation_json,deleted_at FROM knowledge_entry LIMIT 0",
                "SELECT entry_id,revision,content,content_digest,priority,enabled,source,deleted FROM knowledge_revision LIMIT 0",
                "SELECT owner_id,model,entry_revision,content_digest,transformation_version,dim,vector FROM knowledge_embedding LIMIT 0",
            ):
                connection.execute(statement)
            if connection.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise KnowledgeConflictError("Knowledge 原库损坏，拒绝迁移")
            backup_path.parent.mkdir(parents=True, exist_ok=True)
            # 原子占位避免覆盖既有备份；任何失败均保留恢复材料，由操作者判断处理。
            with backup_path.open("xb"):
                pass
            with closing(sqlite3.connect(self._path.resolve().as_uri() + "?mode=ro", uri=True)) as reader, closing(sqlite3.connect(backup_path)) as backup:
                reader.backup(backup)
                if backup.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                    raise KnowledgeConflictError("Knowledge backup 校验失败")
            statement = ""
            created = set()
            for line in self._migration_path.read_text(encoding="utf-8").splitlines():
                statement += line + "\n"
                if sqlite3.complete_statement(statement):
                    for name in _TABLES - _V1_TABLES:
                        if statement.strip().startswith(f"CREATE TABLE {name} ("):
                            connection.execute(statement)
                            created.add(name)
                    statement = ""
            if created != _TABLES - _V1_TABLES or statement.strip():
                raise KnowledgeConflictError("Knowledge 迁移 SQL 不完整")
            for probe in (
                "SELECT source_id,revision,declaration_json FROM knowledge_resource_source LIMIT 0",
                "SELECT entry_id,entry_revision,source_id,source_revision,snapshot_json,raw_content,parser_version,chunk_version FROM knowledge_resource_revision LIMIT 0",
            ):
                connection.execute(probe)
            connection.execute("PRAGMA user_version=2")
            if connection.execute("PRAGMA foreign_key_check").fetchall():
                raise KnowledgeConflictError("Knowledge 迁移引用校验失败")
            connection.commit()

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
                "SELECT source_id,revision,declaration_json FROM knowledge_resource_source LIMIT 0",
                "SELECT entry_id,entry_revision,source_id,source_revision,snapshot_json,raw_content,parser_version,chunk_version FROM knowledge_resource_revision LIMIT 0",
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

    async def register_resource_source(self, source: KnowledgeResourceSource, *, expected_revision: int = 0) -> int:
        if not isinstance(source, KnowledgeResourceSource) or type(expected_revision) is not int or not 0 <= expected_revision < 2**53 - 1:
            raise KnowledgeConflictError("Knowledge source revision invalid")
        encoded = json.dumps(asdict(source), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        async with self._transaction() as connection:
            cursor = await connection.execute("SELECT revision,declaration_json FROM knowledge_resource_source WHERE source_id=?", (source.source_id,))
            previous = await cursor.fetchone()
            if (previous[0] if previous else 0) != expected_revision:
                raise KnowledgeConflictError("Knowledge source revision conflict")
            cursor = await connection.execute("SELECT revision,content_digest,source FROM knowledge_entry WHERE entry_id=?", (source.entry_id,))
            entry = await cursor.fetchone()
            if entry is not None and entry[2] != "resource":
                raise KnowledgeConflictError("Resource 不能覆盖另一 Knowledge 来源")
            if previous and previous[1] == encoded:
                return previous[0]
            if entry:
                await self._invalidate_resource(connection, KnowledgeRevision(source.entry_id, entry[0], entry[2], entry[1]))
            revision = expected_revision + 1
            await connection.execute("INSERT INTO knowledge_resource_source(source_id,revision,declaration_json) VALUES(?,?,?) ON CONFLICT(source_id) DO UPDATE SET revision=excluded.revision,declaration_json=excluded.declaration_json", (source.source_id, revision, encoded))
            return revision

    async def get_resource_source(self, source_id: str) -> tuple[KnowledgeResourceSource, int, int] | None:
        async with self._connection_lock:
            cursor = await self._conn.execute("SELECT revision,declaration_json FROM knowledge_resource_source WHERE source_id=?", (source_id,))
            row = await cursor.fetchone()
            if row is None:
                return None
            source = _source_from_json(row[1])
            if source.source_id != source_id:
                raise KnowledgeConflictError("Knowledge source identity conflict")
            cursor = await self._conn.execute("SELECT revision FROM knowledge_entry WHERE entry_id=?", (source.entry_id,))
            entry = await cursor.fetchone()
            return source, row[0], entry[0] if entry else 0

    async def upsert_resource_entry(self, capture: KnowledgeResourceCapture, *, expected_source_revision: int, expected_entry_revision: int) -> KnowledgeRevision:
        if resource_capture_from(capture.source, capture.snapshot) != capture:
            raise KnowledgeConflictError("Knowledge Resource 转换不匹配")
        if type(expected_source_revision) is not int or not 1 <= expected_source_revision <= 2**53 - 1 \
                or type(expected_entry_revision) is not int or not 0 <= expected_entry_revision < 2**53 - 1:
            raise KnowledgeConflictError("Knowledge Resource 修订非法")
        source, encoded = capture.source, _capture_json(capture)
        async with self._transaction() as connection:
            cursor = await connection.execute("SELECT revision,declaration_json FROM knowledge_resource_source WHERE source_id=?", (source.source_id,))
            declaration = await cursor.fetchone()
            if declaration is None or declaration[0] != expected_source_revision or _source_from_json(declaration[1]) != source:
                raise KnowledgeConflictError("Knowledge source revision conflict")
            cursor = await connection.execute("SELECT e.revision,e.content_digest,e.source,e.deleted_at,r.snapshot_json FROM knowledge_entry e LEFT JOIN knowledge_resource_revision r ON r.entry_id=e.entry_id AND r.entry_revision=e.revision WHERE e.entry_id=?", (source.entry_id,))
            row = await cursor.fetchone()
            if row is not None and row[2] != "resource":
                raise KnowledgeConflictError("Resource 不能覆盖另一 Knowledge 来源")
            if row and row[3] is None and row[4] == encoded:
                return KnowledgeRevision(source.entry_id, row[0], "resource", row[1])
            if (row[0] if row else 0) != expected_entry_revision:
                raise KnowledgeConflictError("Knowledge Resource entry revision conflict")
            revision, digest = expected_entry_revision + 1, content_digest(capture.content)
            await self._write_revision(connection, entry_id=source.entry_id, revision=revision,
                content=capture.content, digest=digest, priority=source.priority, enabled=1,
                source="resource", owner_source="resource", deleted=0)
            await connection.execute("INSERT INTO knowledge_resource_revision(entry_id,entry_revision,source_id,source_revision,snapshot_json,raw_content,parser_version,chunk_version) VALUES(?,?,?,?,?,?,?,?)", (source.entry_id, revision, source.source_id, expected_source_revision, encoded, capture.snapshot.content, capture.parser_version, capture.chunk_version))
            return KnowledgeRevision(source.entry_id, revision, "resource", digest)

    async def invalidate_resource_entry(self, reference: KnowledgeRevision) -> None:
        async with self._transaction() as connection:
            await self._invalidate_resource(connection, reference)

    async def _invalidate_resource(self, connection: aiosqlite.Connection, reference: KnowledgeRevision) -> None:
        cursor = await connection.execute("SELECT revision,content,content_digest,priority,source,deleted_at FROM knowledge_entry WHERE entry_id=?", (reference.entry_id,))
        row = await cursor.fetchone()
        if row is None or row[5] is not None or (row[0], row[2], row[4]) != (reference.revision, reference.content_digest, "resource") or reference.source != "resource":
            return
        await self._write_revision(connection, entry_id=reference.entry_id, revision=row[0] + 1,
            content=row[1], digest=row[2], priority=row[3], enabled=0,
            source="system", owner_source="resource", deleted=1)

    async def get_all_entries(self) -> list[dict[str, Any]]:
        async with self._connection_lock:
            cursor = await self._conn.execute(
                "SELECT e.entry_id,e.content,e.priority,e.enabled,e.scope,e.source,e.activation_json,e.revision,e.content_digest,"
                "r.snapshot_json,r.raw_content,r.parser_version,r.chunk_version,r.source_revision,s.revision "
                "FROM knowledge_entry e LEFT JOIN knowledge_resource_revision r ON r.entry_id=e.entry_id AND r.entry_revision=e.revision "
                "LEFT JOIN knowledge_resource_source s ON s.source_id=r.source_id "
                "WHERE e.deleted_at IS NULL ORDER BY e.priority DESC,e.entry_id"
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
                    "resource": _capture_from_row(row[9:13]) if row[5] == "resource" and row[9] is not None and row[13] == row[14] else None,
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
        if type(revision) is not int or not 1 <= revision <= 2**53 - 1:
            raise KnowledgeConflictError("Knowledge revision overflow")
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
