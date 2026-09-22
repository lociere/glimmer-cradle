"""SQLite 持久 Turn store。"""

from __future__ import annotations

from pathlib import Path

import aiosqlite

from glimmer_cradle.conversation.turns.turn import ConversationTurn, TurnStatus
from glimmer_cradle.conversation.turns.turn_store_port import (
    TurnConflictError,
    TurnTransitionError,
)

_DDL = """
CREATE TABLE IF NOT EXISTS conversation_turns(
  turn_id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  continuity_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  recall_scope TEXT NOT NULL,
  disclosure_scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('accepted','running','completed','interrupted','failed')),
  revision INTEGER NOT NULL CHECK(revision > 0),
  accepted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  terminal_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_conversation_turns_thread
  ON conversation_turns(conversation_id,thread_id,accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_turns_status
  ON conversation_turns(status,updated_at);
"""


class SqliteTurnStore:
    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._conn: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        if self._conn is not None:
            return
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(str(self._db_path))
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.executescript(_DDL)
        await self._conn.commit()

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def create(self, turn: ConversationTurn) -> ConversationTurn:
        conn = self._connection
        try:
            await conn.execute(
                "INSERT INTO conversation_turns VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                self._values(turn),
            )
            await conn.commit()
            return turn
        except aiosqlite.IntegrityError:
            await conn.rollback()
            existing = await self.load(turn.turn_id)
            if existing is None or existing != turn:
                raise TurnConflictError(
                    f"Conversation Turn identity 冲突: {turn.turn_id}"
                ) from None
            return existing

    async def load(self, turn_id: str) -> ConversationTurn | None:
        cursor = await self._connection.execute(
            """SELECT turn_id,scene_id,conversation_id,continuity_id,thread_id,
                      recall_scope,disclosure_scope,status,revision,accepted_at,
                      updated_at,terminal_reason
               FROM conversation_turns WHERE turn_id=?""",
            (turn_id,),
        )
        row = await cursor.fetchone()
        return ConversationTurn(*row) if row else None

    async def transition(
        self,
        turn_id: str,
        *,
        expected_revision: int,
        from_statuses: frozenset[TurnStatus],
        to_status: TurnStatus,
        updated_at: str,
        terminal_reason: str | None,
    ) -> ConversationTurn:
        if not from_statuses:
            raise ValueError("Turn 转换必须指定来源状态")
        placeholders = ",".join("?" for _ in from_statuses)
        params = (
            to_status,
            expected_revision + 1,
            updated_at,
            terminal_reason,
            turn_id,
            expected_revision,
            *sorted(from_statuses),
        )
        cursor = await self._connection.execute(
            f"""UPDATE conversation_turns
                SET status=?,revision=?,updated_at=?,terminal_reason=?
                WHERE turn_id=? AND revision=? AND status IN ({placeholders})""",
            params,
        )
        if cursor.rowcount != 1:
            await self._connection.rollback()
            current = await self.load(turn_id)
            if current is None:
                raise KeyError(f"Conversation Turn 不存在: {turn_id}")
            if current.revision != expected_revision:
                raise TurnConflictError(f"Conversation Turn 修订冲突: {turn_id}")
            raise TurnTransitionError(
                f"Conversation Turn 非法转换: {current.status} -> {to_status}"
            )
        await self._connection.commit()
        result = await self.load(turn_id)
        if result is None:  # pragma: no cover - UPDATE 成功后的数据库不变量
            raise RuntimeError(f"Conversation Turn 更新后丢失: {turn_id}")
        return result

    async def recover_active(self, *, interrupted_at: str, reason: str) -> int:
        cursor = await self._connection.execute(
            """UPDATE conversation_turns
               SET status='interrupted',revision=revision+1,updated_at=?,terminal_reason=?
               WHERE status IN ('accepted','running')""",
            (interrupted_at, reason),
        )
        await self._connection.commit()
        return max(0, cursor.rowcount)

    @staticmethod
    def _values(turn: ConversationTurn) -> tuple[object, ...]:
        return (
            turn.turn_id,
            turn.scene_id,
            turn.conversation_id,
            turn.continuity_id,
            turn.thread_id,
            turn.recall_scope,
            turn.disclosure_scope,
            turn.status,
            turn.revision,
            turn.accepted_at,
            turn.updated_at,
            turn.terminal_reason,
        )

    @property
    def _connection(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("SqliteTurnStore 尚未连接")
        return self._conn
