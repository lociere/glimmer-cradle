"""SQLite adapter for native cognition Loop checkpoints."""

from __future__ import annotations

from pathlib import Path

import aiosqlite

from glimmer_cradle.cognition.loop.checkpoint import LoopCheckpoint


class SqliteCheckpointStore:
    def __init__(
        self,
        path: Path,
        *,
        migration_path: Path | None = None,
    ) -> None:
        self._path = path
        self._migration_path = migration_path or (
            Path(__file__).resolve().parents[5] / "migrations" / "005-checkpoints.sql"
        )
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

    async def close(self) -> None:
        connection, self._connection = self._connection, None
        if connection is not None:
            await connection.close()

    async def load(self, checkpoint_key: str) -> LoopCheckpoint | None:
        cursor = await self._conn.execute(
            "SELECT cycle_count,status,revision,updated_at FROM loop_checkpoint "
            "WHERE checkpoint_key=?",
            (checkpoint_key,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return LoopCheckpoint(
            checkpoint_key=checkpoint_key,
            cycle_count=int(row[0]),
            status=str(row[1]),
            revision=int(row[2]),
            updated_at=str(row[3]),
        )

    async def save(
        self, checkpoint: LoopCheckpoint, *, expected_revision: int
    ) -> LoopCheckpoint:
        connection = self._conn
        await connection.execute("BEGIN IMMEDIATE")
        try:
            cursor = await connection.execute(
                "SELECT revision FROM loop_checkpoint WHERE checkpoint_key=?",
                (checkpoint.checkpoint_key,),
            )
            row = await cursor.fetchone()
            actual_revision = int(row[0]) if row is not None else 0
            if actual_revision != expected_revision:
                raise RuntimeError("Loop checkpoint revision conflict")
            revision = actual_revision + 1
            await connection.execute(
                """
                INSERT INTO loop_checkpoint(checkpoint_key,cycle_count,status,revision)
                VALUES(?,?,?,?)
                ON CONFLICT(checkpoint_key) DO UPDATE SET
                  cycle_count=excluded.cycle_count,status=excluded.status,
                  revision=excluded.revision,updated_at=CURRENT_TIMESTAMP
                """,
                (
                    checkpoint.checkpoint_key,
                    checkpoint.cycle_count,
                    checkpoint.status,
                    revision,
                ),
            )
            await connection.commit()
        except Exception:
            await connection.rollback()
            raise
        saved = await self.load(checkpoint.checkpoint_key)
        assert saved is not None
        return saved

    @property
    def _conn(self) -> aiosqlite.Connection:
        if self._connection is None:
            raise RuntimeError("Loop checkpoint store is not connected")
        return self._connection
