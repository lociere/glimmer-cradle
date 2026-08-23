"""关系投影的内部领域状态。"""

from dataclasses import dataclass, field
import math


@dataclass(frozen=True)
class RelationshipRecord:
    actor_id: str
    display_name: str
    first_seen_at: str
    last_seen_at: str
    direct_interactions: int
    ambient_observations: int
    replies: int
    summary: str = ""
    attributes: dict = field(default_factory=dict)
    confidence: float = 0.0

    @property
    def familiarity(self) -> float:
        weighted = self.direct_interactions + self.replies * 0.5 + self.ambient_observations * 0.1
        return 1.0 - math.exp(-weighted / 20.0)
