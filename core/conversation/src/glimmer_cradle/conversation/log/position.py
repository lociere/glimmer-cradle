"""Conversation Log 中单调递增的全局位置。"""

from __future__ import annotations

from typing import NewType

LogPosition = NewType("LogPosition", int)


def as_log_position(value: int) -> LogPosition:
    if value < 0:
        raise ValueError("Conversation Log position 不得为负数")
    return LogPosition(value)


__all__ = ["LogPosition", "as_log_position"]
