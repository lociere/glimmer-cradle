"""History 投影所需的最小 ordered fact 契约。"""

from __future__ import annotations

from typing import Protocol


class ConversationFact(Protocol):
    """Conversation Log reader 与投影之间的最小结构契约。"""

    seq: int
    moment_id: str
    occurred_at: str
    kind: str
    content: dict
    scene_id: str | None
    conversation_id: str
    continuity_id: str
    thread_id: str
    interaction_id: str
    actor_id: str | None
    actor_name: str | None
    importance: float
    recall_scope: str
    disclosure_scope: str
