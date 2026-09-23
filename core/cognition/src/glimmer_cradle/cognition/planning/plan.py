"""Provider-neutral cognition action plan."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

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
    def reply(goal: str, reason: str = "无需外部能力") -> "ActionPlan":
        return ActionPlan(
            action="reply",
            original_goal=goal,
            goal=goal,
            capability_kind="none",
            reason=reason,
            confidence=0.0,
        )
