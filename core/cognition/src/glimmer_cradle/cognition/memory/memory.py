"""长期记忆的类型与版本化记录。"""

from dataclasses import dataclass, field
from enum import StrEnum
import math
from typing import Any

from glimmer_cradle.conversation import Moment


class MemoryKind(StrEnum):
    EPISODIC = "episodic"
    SEMANTIC = "semantic"
    SOCIAL = "social"
    AUTOBIOGRAPHICAL = "autobiographical"
    PROSPECTIVE = "prospective"
    PROCEDURAL = "procedural"


@dataclass(frozen=True, slots=True)
class MemoryRecord:
    memory_id: str
    revision_id: str
    kind: MemoryKind
    status: str
    content: str
    summary: str
    actor_id: str | None
    scene_id: str | None
    conversation_id: str | None
    continuity_id: str | None
    recall_scope: str
    disclosure_scope: str
    confidence: float
    salience: float
    valid_from: str
    updated_at: str
    attributes: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Episode:
    """从 Conversation Moment 派生、可重建的经历投影。"""

    episode_id: str
    version: int
    interaction_id: str
    scene_id: str
    conversation_id: str
    recall_scope: str
    disclosure_scope: str
    actor_id: str | None
    first_position: int
    last_position: int
    started_at: str
    ended_at: str
    boundary_reason: str
    salience: float
    moments: tuple[Moment, ...]


@dataclass(frozen=True)
class RelationshipRecord:
    """从 Conversation 事实派生的关系记忆投影。"""

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
        weighted = (
            self.direct_interactions
            + self.replies * 0.5
            + self.ambient_observations * 0.1
        )
        return 1.0 - math.exp(-weighted / 20.0)
