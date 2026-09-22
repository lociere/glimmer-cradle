"""Cognition-owned affect and activity state models."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from enum import StrEnum
from typing import Final


class EmotionType(StrEnum):
    CALM = "calm"
    HAPPY = "happy"
    SHY = "shy"
    ANGRY = "angry"
    SULKY = "sulky"
    CURIOUS = "curious"
    SAD = "sad"


@dataclass(slots=True)
class EmotionState:
    emotion_type: EmotionType
    intensity: float
    trace_id: str
    timestamp: datetime
    trigger: str = ""


class CognitiveActivityState(StrEnum):
    QUIESCENT = "quiescent"
    AMBIENT = "ambient"
    ENGAGED = "engaged"


class ModelTier(StrEnum):
    NONE = "none"
    LOCAL_ONLY = "local_only"
    CLOUD_ALLOWED = "cloud_allowed"


@dataclass(frozen=True, slots=True)
class CognitiveActivityPolicy:
    frequency_hint_ms: int
    allows_proactive: bool
    model_tier: ModelTier
    context_budget_factor: float

    def model_dump(self) -> dict[str, object]:
        return asdict(self)


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
