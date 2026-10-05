"""SQLite store for curated Knowledge revisions and rebuildable vectors."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import aiosqlite
import numpy as np

from glimmer_cradle.cognition.knowledge.invalidation import require_authorized_source
from glimmer_cradle.cognition.knowledge.transformation import content_digest


class SqliteKnowledgeStore:
    def __init__(
        self,
        path: Path,
        *,
        migration_path: Path | None = None,
        legacy_memory_path: Path | None = None,
    ) -> None:
        self._path = path
        self._migration_path = migration_path or (
            Path(__file__).resolve().parents[5] / "migrations" / "003-knowledge.sql"
        )
        self._legacy_memory_path = legacy_memory_path or path.with_name("memory.sqlite")
        self._connection: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        if self._connection is not None:
            return
        self._path.parent.mkdir(parents=True, exist_ok=True)
        connection = await aiosqlite.connect(self._path)
        await connection.execute("PRAGMA journal_mode=WAL")
        await connection.executescript(self._migration_path.read_text(encoding="utf-8"))
        await connection.commit()
        self._connection = connection
        await self._import_legacy_if_empty()

    async def close(self) -> None:
        connection, self._connection = self._connection, None
        if connection is not None:
            await connection.close()

    async def replace_config_entries(self, entries: list[dict[str, Any]]) -> None:
        require_authorized_source("config")
        connection = self._conn
        incoming = {str(item["entry_id"]): item for item in entries}
        cursor = await connection.execute(
            "SELECT entry_id,revision,content,content_digest,priority,enabled,deleted_at "
            "FROM knowledge_entry WHERE source='config'"
        )
        existing = {row[0]: row for row in await cursor.fetchall()}
        await connection.execute("BEGIN IMMEDIATE")
        try:
            for entry_id, item in incoming.items():
                content = str(item["content"]).strip()
                digest = content_digest(content)
                priority = int(item.get("priority", 1))
                enabled = 1 if item.get("enabled", True) else 0
                row = existing.get(entry_id)
                if (
                    row
                    and row[3] == digest
                    and row[4] == priority
                    and row[5] == enabled
                    and row[6] is None
                ):
                    continue
                revision = (int(row[1]) + 1) if row else 1
                await self._write_revision(
                    entry_id=entry_id,
                    revision=revision,
                    content=content,
                    digest=digest,
                    priority=priority,
                    enabled=enabled,
                    source="config",
                    deleted=0,
                )
            for entry_id, row in existing.items():
                if entry_id in incoming or row[6] is not None:
                    continue
                await self._write_revision(
                    entry_id=entry_id,
                    revision=int(row[1]) + 1,
                    content=str(row[2]),
                    digest=str(row[3]),
                    priority=int(row[4]),
                    enabled=0,
                    source="config",
                    deleted=1,
                )
            await connection.commit()
        except Exception:
            await connection.rollback()
            raise

    async def delete_entry(
        self, entry_id: str, *, expected_revision: int, source: str
    ) -> int:
        require_authorized_source(source)
        cursor = await self._conn.execute(
            "SELECT revision,content,content_digest,priority,source FROM knowledge_entry "
            "WHERE entry_id=? AND deleted_at IS NULL",
            (entry_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            raise KeyError(entry_id)
        if int(row[0]) != expected_revision:
            raise RuntimeError("Knowledge revision conflict")
        revision = expected_revision + 1
        await self._conn.execute("BEGIN IMMEDIATE")
        try:
            await self._write_revision(
                entry_id=entry_id,
                revision=revision,
                content=str(row[1]),
                digest=str(row[2]),
                priority=int(row[3]),
                enabled=0,
                source=source,
                deleted=1,
            )
            await self._conn.execute(
                "DELETE FROM knowledge_embedding WHERE owner_id=?", (entry_id,)
            )
            await self._conn.commit()
        except Exception:
            await self._conn.rollback()
            raise
        return revision

    async def get_all_entries(self) -> list[dict[str, Any]]:
        cursor = await self._conn.execute(
            "SELECT entry_id,content,priority,enabled,scope,source,activation_json,revision "
            "FROM knowledge_entry WHERE deleted_at IS NULL ORDER BY priority DESC"
        )
        rows = await cursor.fetchall()
        return [
            {
                "entry_id": row[0],
                "content": row[1],
                "priority": row[2],
                "enabled": bool(row[3]),
                "scope": row[4],
                "source": row[5],
                "activation": json.loads(row[6]) if row[6] else {},
                "revision": row[7],
            }
            for row in rows
        ]

    async def get_vectors(self, owner_kind: str, model: str) -> dict[str, np.ndarray]:
        if owner_kind != "knowledge":
            return {}
        cursor = await self._conn.execute(
            "SELECT owner_id,dim,vector FROM knowledge_embedding WHERE model=?", (model,)
        )
        return {
            row[0]: np.frombuffer(row[2], dtype=np.float32, count=int(row[1])).copy()
            for row in await cursor.fetchall()
        }

    async def upsert_vector(
        self, *, owner_kind: str, owner_id: str, model: str, vector: np.ndarray
    ) -> None:
        if owner_kind != "knowledge":
            raise ValueError("SqliteKnowledgeStore only accepts knowledge vectors")
        normalized = np.asarray(vector, dtype=np.float32)
        await self._conn.execute(
            """
            INSERT INTO knowledge_embedding(owner_id,model,dim,vector)
            VALUES(?,?,?,?)
            ON CONFLICT(owner_id,model) DO UPDATE SET
              dim=excluded.dim,vector=excluded.vector,updated_at=CURRENT_TIMESTAMP
            """,
            (owner_id, model, int(normalized.size), normalized.tobytes()),
        )
        await self._conn.commit()

    async def _write_revision(
        self,
        *,
        entry_id: str,
        revision: int,
        content: str,
        digest: str,
        priority: int,
        enabled: int,
        source: str,
        deleted: int,
    ) -> None:
        await self._conn.execute(
            """
            INSERT INTO knowledge_revision(
              entry_id,revision,content,content_digest,priority,enabled,source,deleted
            ) VALUES(?,?,?,?,?,?,?,?)
            """,
            (entry_id, revision, content, digest, priority, enabled, source, deleted),
        )
        await self._conn.execute(
            """
            INSERT INTO knowledge_entry(
              entry_id,revision,content,content_digest,priority,enabled,scope,source,
              activation_json,deleted_at
            ) VALUES(?,?,?,?,?,?,'knowledge',?,'{}',CASE WHEN ? THEN CURRENT_TIMESTAMP END)
            ON CONFLICT(entry_id) DO UPDATE SET
              revision=excluded.revision,content=excluded.content,
              content_digest=excluded.content_digest,priority=excluded.priority,
              enabled=excluded.enabled,source=excluded.source,
              deleted_at=excluded.deleted_at,updated_at=CURRENT_TIMESTAMP
            """,
            (entry_id, revision, content, digest, priority, enabled, source, deleted),
        )

    async def _import_legacy_if_empty(self) -> None:
        if self._legacy_memory_path.resolve() == self._path.resolve():
            return
        cursor = await self._conn.execute("SELECT COUNT(1) FROM knowledge_entry")
        count = await cursor.fetchone()
        if count and int(count[0]) > 0:
            return
        if not self._legacy_memory_path.exists():
            return
        legacy = await aiosqlite.connect(self._legacy_memory_path)
        try:
            cursor = await legacy.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_entry'"
            )
            if await cursor.fetchone() is None:
                return
            cursor = await legacy.execute(
                "SELECT entry_id,content,priority,enabled,source,activation_json "
                "FROM knowledge_entry ORDER BY entry_id"
            )
            rows = await cursor.fetchall()
        finally:
            await legacy.close()
        if not rows:
            return
        await self._conn.execute("BEGIN IMMEDIATE")
        try:
            for row in rows:
                digest = content_digest(str(row[1]))
                await self._conn.execute(
                    """
                    INSERT INTO knowledge_revision(
                      entry_id,revision,content,content_digest,priority,enabled,source,deleted
                    ) VALUES(?,1,?,?,?,?,?,0)
                    """,
                    (row[0], row[1], digest, row[2], row[3], row[4]),
                )
                await self._conn.execute(
                    """
                    INSERT INTO knowledge_entry(
                      entry_id,revision,content,content_digest,priority,enabled,scope,source,
                      activation_json,deleted_at
                    ) VALUES(?,1,?,?,?,?,'knowledge',?,?,NULL)
                    """,
                    (row[0], row[1], digest, row[2], row[3], row[4], row[5]),
                )
            await self._conn.commit()
        except Exception:
            await self._conn.rollback()
            raise
    @property
    def _conn(self) -> aiosqlite.Connection:
        if self._connection is None:
            raise RuntimeError("Knowledge store is not connected")
        return self._connection
