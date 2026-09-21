"""认知循环单拍状态。"""

from __future__ import annotations

from dataclasses import dataclass, field

from glimmer_cradle.conversation import ConversationTurn
from glimmer_cradle.cognition.application.cycle.action_planner import ActionPlan
from glimmer_cradle.cognition.domain.volition import ArbitrationResult


@dataclass(slots=True)
class CycleTurn:
    """只在一拍内有效的感知、规划与仲裁状态。"""

    perception_moment_ids: list[str] = field(default_factory=list)
    perception_moment_ids_by_trace: dict[str, list[str]] = field(default_factory=dict)
    emotion_moment_id: str | None = None
    pending_emotion_state: dict | None = None
    turn: ConversationTurn = field(default_factory=ConversationTurn)
    turns_by_trace: dict[str, ConversationTurn] = field(default_factory=dict)
    response_policies: list[str] = field(default_factory=list)
    response_policy_by_trace: dict[str, list[str]] = field(default_factory=dict)
    routes: dict[str, dict] = field(default_factory=dict)
    reply: str | None = None
    skill_request: dict | None = None
    action_plan: ActionPlan | None = None
    arbitration: ArbitrationResult | None = None
