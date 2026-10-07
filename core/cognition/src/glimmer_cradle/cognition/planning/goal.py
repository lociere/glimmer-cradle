"""Cognition-owned semantic goal definitions."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Goal:
    """A normalized goal considered by the cognition planning boundary."""

    text: str
    scene_id: str = ""
    trace_id: str = ""

    @classmethod
    def normalize(cls, text: str, *, scene_id: str = "", trace_id: str = "") -> Goal:
        return cls(text=text.strip(), scene_id=scene_id, trace_id=trace_id)


@dataclass(frozen=True, slots=True)
class GoalVersion:
    """不可变长期目标；完成条件只由 Cognition 解释，不由 Jobs 状态替代。"""

    goal_id: str
    scope_id: str
    version: int
    text: str
    completion_condition: str

    def __post_init__(self) -> None:
        if any(
            not isinstance(value, str) or not value.strip()
            for value in (
                self.goal_id,
                self.scope_id,
                self.text,
                self.completion_condition,
            )
        ):
            raise ValueError("长期目标身份、语义与完成条件不得为空")
        if type(self.version) is not int or not 1 <= self.version <= 2**53 - 1:
            raise ValueError("长期目标版本无效")
