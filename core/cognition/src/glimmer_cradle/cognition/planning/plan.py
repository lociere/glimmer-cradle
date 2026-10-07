"""Cognition-owned immutable long-term plan."""

from __future__ import annotations

from dataclasses import dataclass

from glimmer_cradle.cognition.planning.goal import GoalVersion


@dataclass(frozen=True, slots=True)
class PlanVersion:
    """明确接受前的长期计划版本；步骤是认知语义，不是平台指令。"""

    plan_id: str
    version: int
    goal: GoalVersion
    steps: tuple[str, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.plan_id, str) or not self.plan_id.strip():
            raise ValueError("计划身份不得为空")
        if type(self.version) is not int or not 1 <= self.version <= 2**53 - 1:
            raise ValueError("计划版本无效")
        if not isinstance(self.goal, GoalVersion) or not isinstance(self.steps, tuple):
            raise TypeError("计划目标与步骤必须不可变")
        if not 1 <= len(self.steps) <= 64 or any(
            not isinstance(step, str) or not step.strip() for step in self.steps
        ):
            raise ValueError("计划必须有 1 至 64 个非空语义步骤")
