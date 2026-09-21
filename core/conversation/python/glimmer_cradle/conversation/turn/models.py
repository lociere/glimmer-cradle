"""Conversation Turn 的稳定交互上下文。"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class ConversationTurn:
    """一次外界输入引起的完整交互周期；模型推理 Step 不属于该类型。"""

    turn_id: str = ""
    scene_id: str = ""
    conversation_id: str = ""
    continuity_id: str = ""
    thread_id: str = "main"
    recall_scope: str = "conversation_private"
    disclosure_scope: str = "conversation_private"
