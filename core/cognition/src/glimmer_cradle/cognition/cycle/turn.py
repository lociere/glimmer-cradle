"""认知循环单拍状态。"""

from __future__ import annotations

from dataclasses import dataclass, field

from glimmer_cradle.cognition.cycle.action_planner import ActionPlan
from glimmer_cradle.cognition.cycle.volition import ArbitrationResult


@dataclass(frozen=True, slots=True)
class UserConversationTurn:
    scene_id: str
    conversation_id: str
    continuity_id: str
    thread_id: str
    recall_scope: str
    disclosure_scope: str
    text: str
    familiarity: int
    moment_id: str | None
    interaction_id: str | None
    actor_id: str | None
    actor_name: str | None
    retention_ceiling: str


@dataclass(slots=True)
class CycleTurn:
    """只在一拍内有效的感知、规划与仲裁状态。"""

    perception_moment_ids: list[str] = field(default_factory=list)
    emotion_moment_id: str | None = None
    scene_id: str = ""
    conversation_id: str = ""
    continuity_id: str = ""
    thread_id: str = "main"
    recall_scope: str = "conversation_private"
    disclosure_scope: str = "conversation_private"
    trace_id: str = ""
    user_turns: list[UserConversationTurn] = field(default_factory=list)
    response_policies: list[str] = field(default_factory=list)
    routes: dict[str, dict] = field(default_factory=dict)
    reply: str | None = None
    skill_request: dict | None = None
    action_plan: ActionPlan | None = None
    arbitration: ArbitrationResult | None = None
