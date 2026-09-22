"""从 History 投影恢复的有界进程缓存。"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from glimmer_cradle.conversation.messages.message import ConversationMessage


@dataclass(slots=True)
class ConversationWorkingSet:
    """可重建缓存，不拥有 Conversation 历史事实。"""

    conversation_id: str
    thread_id: str = "main"
    messages: list[ConversationMessage] = field(default_factory=list)
    state: dict = field(default_factory=dict)
    hydrated: bool = False
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def recent(self, limit: int) -> list[ConversationMessage]:
        return self.messages[-limit:] if limit > 0 else []


__all__ = ["ConversationWorkingSet"]
