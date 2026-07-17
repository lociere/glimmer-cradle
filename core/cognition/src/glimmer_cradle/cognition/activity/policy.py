"""认知活动状态对应的资源策略与转换阈值。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from glimmer_cradle.cognition.protocol.generated.enums.cognitive_activity_state import (
    CognitiveActivityState,
)
from glimmer_cradle.cognition.protocol.generated.models.cognitive_activity_policy import (
    CognitiveActivityPolicy,
    ModelTier,
)


POLICY_BY_STATE: Final[dict[CognitiveActivityState, CognitiveActivityPolicy]] = {
    CognitiveActivityState.QUIESCENT: CognitiveActivityPolicy(
        frequency_hint_ms=60000,
        allows_proactive=False,
        model_tier=ModelTier.NONE,
        context_budget_factor=0.0,
    ),
    CognitiveActivityState.AMBIENT: CognitiveActivityPolicy(
        frequency_hint_ms=45000,
        allows_proactive=True,
        model_tier=ModelTier.LOCAL_ONLY,
        context_budget_factor=0.6,
    ),
    CognitiveActivityState.ENGAGED: CognitiveActivityPolicy(
        frequency_hint_ms=10000,
        allows_proactive=True,
        model_tier=ModelTier.CLOUD_ALLOWED,
        context_budget_factor=1.0,
    ),
}


def policy_for(state: CognitiveActivityState) -> CognitiveActivityPolicy:
    return POLICY_BY_STATE[state]


@dataclass(frozen=True)
class ActivityTransitionConfig:
    """认知活动状态转换阈值，不承载情感或记忆维护语义。"""

    engaged_to_ambient_idle_s: float = 120.0
    ambient_to_quiescent_idle_s: float = 600.0
    minimum_residence_s: float = 10.0
    affect_activation_hold_threshold: float = 0.8


DEFAULT_ACTIVITY_TRANSITION_CONFIG: Final[ActivityTransitionConfig] = (
    ActivityTransitionConfig()
)
