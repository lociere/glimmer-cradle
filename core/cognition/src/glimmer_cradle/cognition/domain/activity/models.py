"""认知活动的内部领域状态与资源策略。"""

from dataclasses import asdict, dataclass
from enum import StrEnum


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
