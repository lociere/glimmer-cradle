"""会话查询投影与可重建工作集模型。"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class ConversationMessage:
    position: int
    moment_id: str
    conversation_id: str
    scene_id: str
    thread_id: str
    interaction_id: str
    role: str
    content: str
    actor_id: str | None
    actor_name: str | None
    occurred_at: str
    importance: float
    recall_scope: str
    disclosure_scope: str

    def prompt_line(self) -> str:
        return f"{self.role}: {self.content}"


@dataclass(slots=True)
class ConversationWorkingSet:
    """由 Conversation Store 恢复的有界缓存，不拥有历史事实。"""

    conversation_id: str
    messages: list[ConversationMessage] = field(default_factory=list)
    state: dict = field(default_factory=dict)
    hydrated: bool = False
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def recent(self, limit: int) -> list[ConversationMessage]:
        return self.messages[-limit:] if limit > 0 else []
