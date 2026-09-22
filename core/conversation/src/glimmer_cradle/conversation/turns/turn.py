"""Conversation 拥有的持久 Turn 模型。"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Literal

TurnStatus = Literal["accepted", "running", "completed", "interrupted", "failed"]
TERMINAL_TURN_STATUSES: frozenset[TurnStatus] = frozenset(
    {"completed", "interrupted", "failed"}
)


@dataclass(frozen=True, slots=True)
class ConversationTurn:
    """一次外界输入引起的完整交互周期；模型推理 Step 不属于该类型。"""

    turn_id: str = ""
    scene_id: str = ""
    conversation_id: str = ""
    continuity_id: str = ""
    thread_id: str = "main"
    recall_scope: str = "conversation_private"
    disclosure_scope: str = "conversation_private"
    status: TurnStatus = "accepted"
    revision: int = 0
    accepted_at: str = ""
    updated_at: str = ""
    terminal_reason: str | None = None

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_TURN_STATUSES

    def accepted(self, timestamp: str) -> ConversationTurn:
        return replace(
            self,
            status="accepted",
            revision=1,
            accepted_at=timestamp,
            updated_at=timestamp,
            terminal_reason=None,
        )
