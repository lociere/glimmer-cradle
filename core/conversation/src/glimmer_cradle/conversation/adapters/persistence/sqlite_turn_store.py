"""SQLite 持久 Turn store。"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager
from importlib.metadata import files
from pathlib import Path

import aiosqlite
from glimmer_cradle.conversation.turns.turn import ConversationTurn, TurnStatus
from glimmer_cradle.conversation.turns.turn_store_port import (
    TurnConflictError,
    TurnTransitionError,
)


def _migration_sql(filename: str) -> str:
    source_path = Path(__file__).resolve().parents[5] / "migrations" / "python" / filename
    if source_path.is_file():
        return source_path.read_text(encoding="utf-8")
    for entry in files("glimmer-cradle-conversation") or ():
        if entry.as_posix().endswith(
            f"share/glimmer-cradle-conversation/migrations/python/{filename}"
        ):
            return Path(entry.locate()).read_text(encoding="utf-8")
    raise RuntimeError(f"Conversation migration 缺失: {filename}")


class SqliteTurnStore:
    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._conn: aiosqlite.Connection | None = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        async with self._lock:
            try:
                await self._settle(self._connect())
            except BaseException:
                if self._conn is not None:
                    await self._cleanup(self._conn.close())
                    self._conn = None
                raise

    async def _connect(self) -> None:
        if self._conn is not None:
            return
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(str(self._db_path))
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.executescript(_migration_sql("002-turns.sql"))
        await self._upgrade_legacy_turn_schema()
        await self._conn.commit()

    async def close(self) -> None:
        async with self._lock:
            if self._conn is not None:
                try:
                    await self._settle(self._conn.close())
                finally:
                    self._conn = None

    async def create(self, turn: ConversationTurn) -> ConversationTurn:
        async with self._transaction():
            return await self._create(turn)

    async def _create(self, turn: ConversationTurn) -> ConversationTurn:
        conn = self._connection
        try:
            await conn.execute(
                """INSERT INTO conversation_turns(
                       turn_id,scene_id,conversation_id,continuity_id,thread_id,
                       recall_scope,disclosure_scope,payload_digest,status,revision,
                       accepted_at,updated_at,terminal_reason
                     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                self._values(turn),
            )
            return turn
        except aiosqlite.IntegrityError:
            existing = await self._load(turn.turn_id)
            if existing is None or existing != turn:
                raise TurnConflictError(
                    f"Conversation Turn identity 冲突: {turn.turn_id}"
                ) from None
            return existing

    async def load(self, turn_id: str) -> ConversationTurn | None:
        async with self._lock:
            return await self._load(turn_id)

    async def _load(self, turn_id: str) -> ConversationTurn | None:
        cursor = await self._connection.execute(
            """SELECT turn_id,scene_id,conversation_id,continuity_id,thread_id,
                      recall_scope,disclosure_scope,status,revision,accepted_at,
                      updated_at,terminal_reason,payload_digest
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
        async with self._transaction():
            return await self._transition(turn_id, expected_revision=expected_revision, from_statuses=from_statuses,
                to_status=to_status, updated_at=updated_at, terminal_reason=terminal_reason)

    async def _transition(
        self, turn_id: str, *, expected_revision: int, from_statuses: frozenset[TurnStatus],
        to_status: TurnStatus, updated_at: str, terminal_reason: str | None,
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
            current = await self._load(turn_id)
            if current is None:
                raise KeyError(f"Conversation Turn 不存在: {turn_id}")
            if current.revision != expected_revision:
                raise TurnConflictError(f"Conversation Turn 修订冲突: {turn_id}")
            raise TurnTransitionError(
                f"Conversation Turn 非法转换: {current.status} -> {to_status}"
            )
        result = await self._load(turn_id)
        if result is None:  # pragma: no cover - UPDATE 成功后的数据库不变量
            raise RuntimeError(f"Conversation Turn 更新后丢失: {turn_id}")
        return result

    async def recover_active(self, *, interrupted_at: str, reason: str) -> int:
        async with self._transaction():
            return await self._recover_active(interrupted_at=interrupted_at, reason=reason)

    async def _recover_active(self, *, interrupted_at: str, reason: str) -> int:
        cursor = await self._connection.execute(
            """UPDATE conversation_turns
               SET status='interrupted',revision=revision+1,updated_at=?,terminal_reason=?
               WHERE status IN ('accepted','running')""",
            (interrupted_at, reason),
        )
        return max(0, cursor.rowcount)

    @asynccontextmanager
    async def _transaction(self) -> AsyncIterator[None]:
        async with self._lock:
            connection = self._connection
            try:
                await self._settle(connection.execute("BEGIN IMMEDIATE"))
                yield
                await self._settle(connection.commit())
            except BaseException:
                # aiosqlite 已排队的实际 IO 不会因等待者取消而停止；排空 rollback 后才交还连接。
                await self._cleanup(connection.rollback())
                raise

    @staticmethod
    async def _settle[T](operation: Awaitable[T]) -> T:
        task = asyncio.ensure_future(operation)
        cancelled: asyncio.CancelledError | None = None
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError as error:
                cancelled = error
        result = task.result()
        if cancelled is not None:
            raise cancelled
        return result

    @staticmethod
    async def _cleanup(operation: Awaitable[object]) -> None:
        task = asyncio.ensure_future(operation)
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                continue
        task.result()

    async def _upgrade_legacy_turn_schema(self) -> None:
        """旧 002 数据没有摘要；补列后由 Controller 对空摘要 fail closed。"""
        cursor = await self._connection.execute("PRAGMA table_info(conversation_turns)")
        columns = {str(row[1]) for row in await cursor.fetchall()}
        if "payload_digest" not in columns:
            await self._connection.execute(
                "ALTER TABLE conversation_turns "
                "ADD COLUMN payload_digest TEXT NOT NULL DEFAULT ''"
            )

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
            turn.payload_digest,
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
