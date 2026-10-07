"""Provider-neutral cognition action plan."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from glimmer_cradle.cognition.planning.goal import GoalVersion

CognitiveAction = Literal["reply", "skill_request", "ask_clarification", "noop"]
CapabilityKind = Literal[
    "web_navigation",
    "realtime_lookup",
    "desktop_action",
    "clipboard",
    "notification",
    "extension_action",
    "mcp_tool",
    "platform_message",
    "none",
]

VALID_ACTIONS = {"reply", "skill_request", "ask_clarification", "noop"}
VALID_CAPABILITY_KINDS = {
    "web_navigation",
    "realtime_lookup",
    "desktop_action",
    "clipboard",
    "notification",
    "extension_action",
    "mcp_tool",
    "platform_message",
    "none",
}


@dataclass(frozen=True, slots=True)
class ActionPlan:
    action: CognitiveAction
    original_goal: str
    goal: str
    capability_kind: CapabilityKind
    reason: str
    confidence: float
    planning_hint: str | None = None

    @staticmethod
    def reply(goal: str, reason: str = "无需外部能力") -> ActionPlan:
        return ActionPlan(
            action="reply",
            original_goal=goal,
            goal=goal,
            capability_kind="none",
            reason=reason,
            confidence=0.0,
        )


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
