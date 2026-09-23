"""SQLite transaction boundary for versioned Cognition memory."""

from __future__ import annotations

from pathlib import Path

import aiosqlite

from glimmer_cradle.cognition.adapters.observability.logger import get_logger
from glimmer_cradle.cognition.adapters.paths import resolve_cognition_db_path, resolve_repo_root

logger = get_logger("sqlite_memory_store")
SCHEMA_VERSION = 3


class SqliteMemoryStore:
    """Own the SQLite connection shared by memory persistence projections."""

    def __init__(
        self,
        db_path: Path | None = None,
        *,
        migration_path: Path | None = None,
    ) -> None:
        self._db_path = db_path or resolve_cognition_db_path()
        self._migration_path = migration_path or (
            resolve_repo_root() / "core" / "cognition" / "migrations" / "002-memory.sql"
        )
        self._conn: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        if self._conn is not None:
            return
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = await aiosqlite.connect(str(self._db_path))
        await connection.execute("PRAGMA journal_mode=WAL")
        await connection.execute("PRAGMA foreign_keys=ON")
        cursor = await connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'"
        )
        if await cursor.fetchone() is None:
            await connection.executescript(self._migration_path.read_text(encoding="utf-8"))
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
                await connection.close()
                raise RuntimeError("检测到非当前记忆架构数据库；须先执行受控数据迁移")
        self._conn = connection
        logger.info(
            "记忆事实库已就绪",
            db_path=str(self._db_path),
            schema_version=SCHEMA_VERSION,
        )

    async def close(self) -> None:
        connection, self._conn = self._conn, None
        if connection is not None:
            await connection.close()

    @property
    def connection(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("SqliteMemoryStore 尚未连接")
        return self._conn
