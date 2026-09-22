"""History 消息参与方；持久值保持与既有 schema 兼容。"""

from __future__ import annotations

from enum import Enum


class Participant(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"


__all__ = ["Participant"]
