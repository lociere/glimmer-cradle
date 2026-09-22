"""Turn 接纳、转换和恢复的唯一应用入口。"""

from __future__ import annotations

from typing import Protocol

from glimmer_cradle.conversation.turns.turn import ConversationTurn, TurnStatus
from glimmer_cradle.conversation.turns.turn_store_port import (
    TurnConflictError,
    TurnStorePort,
    TurnTransitionError,
)


class ClockPort(Protocol):
    def now_iso(self) -> str: ...

_TRANSITIONS: dict[TurnStatus, frozenset[TurnStatus]] = {
    "accepted": frozenset({"running", "completed", "interrupted", "failed"}),
    "running": frozenset({"completed", "interrupted", "failed"}),
    "completed": frozenset(),
    "interrupted": frozenset(),
    "failed": frozenset(),
}


class TurnController:
    def __init__(self, store: TurnStorePort, *, clock: ClockPort) -> None:
        self._store = store
        self._clock = clock
        self._connected = False

    async def connect(self) -> int:
        if self._connected:
            return 0
        await self._store.connect()
        self._connected = True
        try:
            return await self._store.recover_active(
                interrupted_at=self._clock.now_iso(),
                reason="process_restarted",
            )
        except Exception:
            await self._store.close()
            self._connected = False
            raise

    async def close(self) -> None:
        if self._connected:
            await self._store.close()
            self._connected = False

    async def accept(self, candidate: ConversationTurn) -> ConversationTurn:
        self._require_connected()
        self._validate_identity(candidate)
        existing = await self._store.load(candidate.turn_id)
        if existing is not None:
            self._ensure_same_context(existing, candidate)
            return existing
        return await self._store.create(candidate.accepted(self._clock.now_iso()))

    async def start(self, turn_id: str, *, expected_revision: int) -> ConversationTurn:
        return await self._transition(turn_id, "running", expected_revision=expected_revision)

    async def complete(self, turn_id: str, *, expected_revision: int) -> ConversationTurn:
        return await self._transition(turn_id, "completed", expected_revision=expected_revision)

    async def interrupt(
        self, turn_id: str, *, expected_revision: int, reason: str
    ) -> ConversationTurn:
        return await self._transition(
            turn_id, "interrupted", expected_revision=expected_revision, reason=reason
        )

    async def fail(
        self, turn_id: str, *, expected_revision: int, reason: str
    ) -> ConversationTurn:
        return await self._transition(
            turn_id, "failed", expected_revision=expected_revision, reason=reason
        )

    async def load(self, turn_id: str) -> ConversationTurn | None:
        self._require_connected()
        return await self._store.load(turn_id)

    async def _transition(
        self,
        turn_id: str,
        to_status: TurnStatus,
        *,
        expected_revision: int,
        reason: str | None = None,
    ) -> ConversationTurn:
        self._require_connected()
        current = await self._store.load(turn_id)
        if current is None:
            raise KeyError(f"Conversation Turn 不存在: {turn_id}")
        if current.status == to_status:
            if current.revision != expected_revision:
                raise TurnConflictError(f"Conversation Turn 修订冲突: {turn_id}")
            return current
        if to_status not in _TRANSITIONS[current.status]:
            raise TurnTransitionError(
                f"Conversation Turn 非法转换: {current.status} -> {to_status}"
            )
        terminal_reason = reason.strip() if reason and reason.strip() else None
        if to_status in {"interrupted", "failed"} and terminal_reason is None:
            raise ValueError(f"{to_status} Turn 必须提供 reason")
        return await self._store.transition(
            turn_id,
            expected_revision=expected_revision,
            from_statuses=frozenset({current.status}),
            to_status=to_status,
            updated_at=self._clock.now_iso(),
            terminal_reason=terminal_reason,
        )

    def _require_connected(self) -> None:
        if not self._connected:
            raise RuntimeError("TurnController 尚未连接")

    @staticmethod
    def _validate_identity(turn: ConversationTurn) -> None:
        for field_name in (
            "turn_id",
            "scene_id",
            "conversation_id",
            "continuity_id",
            "thread_id",
            "recall_scope",
            "disclosure_scope",
        ):
            value = getattr(turn, field_name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"Conversation Turn {field_name} 不得为空")
        if turn.status != "accepted" or turn.revision != 0:
            raise ValueError("新 Conversation Turn 必须处于未持久化的 accepted/revision=0 状态")

    @staticmethod
    def _ensure_same_context(existing: ConversationTurn, candidate: ConversationTurn) -> None:
        fields = (
            "scene_id",
            "conversation_id",
            "continuity_id",
            "thread_id",
            "recall_scope",
            "disclosure_scope",
        )
        if any(getattr(existing, field) != getattr(candidate, field) for field in fields):
            raise TurnConflictError(
                f"Conversation Turn identity 已绑定不同上下文: {candidate.turn_id}"
            )
