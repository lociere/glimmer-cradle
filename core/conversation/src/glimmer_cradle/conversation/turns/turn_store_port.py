"""持久 Turn 的存储边界。"""

from __future__ import annotations

from typing import Protocol

from glimmer_cradle.conversation.turns.turn import ConversationTurn, TurnStatus


class TurnConflictError(RuntimeError):
    """同一 Turn identity 被用于不同上下文或并发修订。"""


class TurnTransitionError(RuntimeError):
    """请求了不允许的 Turn 状态转换。"""


class TurnStorePort(Protocol):
    async def connect(self) -> None: ...

    async def close(self) -> None: ...

    async def create(self, turn: ConversationTurn) -> ConversationTurn: ...

    async def load(self, turn_id: str) -> ConversationTurn | None: ...

    async def transition(
        self,
        turn_id: str,
        *,
        expected_revision: int,
        from_statuses: frozenset[TurnStatus],
        to_status: TurnStatus,
        updated_at: str,
        terminal_reason: str | None,
    ) -> ConversationTurn: ...

    async def recover_active(self, *, interrupted_at: str, reason: str) -> int: ...
