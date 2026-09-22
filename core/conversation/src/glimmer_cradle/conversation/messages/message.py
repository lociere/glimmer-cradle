"""Conversation 查询投影的消息模型。"""

from __future__ import annotations

from dataclasses import dataclass


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
