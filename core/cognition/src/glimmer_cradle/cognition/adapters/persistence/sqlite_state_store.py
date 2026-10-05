"""SQLite adapter for versioned Cognition state snapshots."""

from __future__ import annotations

import json
from pathlib import Path

import aiosqlite

from glimmer_cradle.cognition.state import StateStore, StoredCognitiveState


class SqliteStateStore(StateStore):
    def __init__(self, db_path: Path, *, migration_path: Path | None = None) -> None:
        self._db_path = db_path
        self._migration_path = migration_path or (
            Path(__file__).resolve().parents[5] / "migrations" / "001-state.sql"
        )
        self._connection: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        if self._connection is not None:
            return
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = await aiosqlite.connect(str(self._db_path))
        await connection.execute("PRAGMA journal_mode=WAL")
        await connection.executescript(self._migration_path.read_text(encoding="utf-8"))
        await connection.commit()
        self._connection = connection

    async def close(self) -> None:
        if self._connection is not None:
            await self._connection.close()
            self._connection = None

    async def load(self, state_key: str) -> StoredCognitiveState | None:
        cursor = await self._conn.execute(
            "SELECT revision,payload_json,updated_at FROM cognitive_state WHERE state_key=?",
            (state_key,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return StoredCognitiveState(
            state_key=state_key,
            revision=int(row[0]),
            payload=json.loads(str(row[1])),
            updated_at=str(row[2]),
        )

    async def save(
        self,
        state: StoredCognitiveState,
        *,
        expected_revision: int | None,
    ) -> StoredCognitiveState:
        existing = await self.load(state.state_key)
        actual_revision = existing.revision if existing is not None else None
        if actual_revision != expected_revision:
            raise RuntimeError("cognitive state revision conflict")
        next_revision = 1 if actual_revision is None else actual_revision + 1
        payload_json = json.dumps(
            state.payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        if existing is None:
            await self._conn.execute(
                "INSERT INTO cognitive_state(state_key,revision,payload_json,updated_at) VALUES(?,?,?,?)",
                (state.state_key, next_revision, payload_json, state.updated_at),
            )
        else:
            cursor = await self._conn.execute(
                "UPDATE cognitive_state SET revision=?,payload_json=?,updated_at=? "
                "WHERE state_key=? AND revision=?",
                (next_revision, payload_json, state.updated_at, state.state_key, actual_revision),
            )
            if cursor.rowcount != 1:
                await self._conn.rollback()
                raise RuntimeError("cognitive state revision conflict")
        await self._conn.commit()
        return StoredCognitiveState(
            state_key=state.state_key,
            revision=next_revision,
            payload=dict(state.payload),
            updated_at=state.updated_at,
        )

    @property
    def _conn(self) -> aiosqlite.Connection:
        if self._connection is None:
            raise RuntimeError("SqliteStateStore is not connected")
        return self._connection
