"""长期记忆的类型与版本化记录。"""

from dataclasses import dataclass, field
from enum import StrEnum
import math
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from glimmer_cradle.conversation import Moment


class _MemorySettings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class WorkingMemorySettings(_MemorySettings):
    max_messages_per_conversation: int = Field(ge=2)
    hydrate_recent_messages: int = Field(ge=2)
    context_message_limit: int = Field(ge=1)


class ConversationProjectionSettings(_MemorySettings):
    segment_target_messages: int = Field(ge=4)
    chapter_idle_minutes: int = Field(ge=1)
    chapter_segment_limit: int = Field(ge=2)
    state_update_messages: int = Field(ge=1)
    history_candidate_limit: int = Field(ge=1)
    history_result_limit: int = Field(ge=1)
    summary_max_chars: int = Field(ge=256)


class ExperienceSettings(_MemorySettings):
    enabled: bool
    pack_max_size_mb: int = Field(ge=16)
    flush_interval_ms: int = Field(ge=50)
    flush_max_buffer: int = Field(ge=1)
    episode_idle_seconds: int = Field(ge=10)
    seal_integrity_check: bool


class ConsolidationSettings(_MemorySettings):
    enabled: bool
    batch_size: int = Field(ge=1)
    max_batch_moments: int = Field(ge=1)
    debounce_seconds: int = Field(ge=0)
    max_wait_seconds: int = Field(ge=10)
    lease_seconds: int = Field(ge=10)
    retry_base_seconds: int = Field(ge=1)
    minimum_salience: float = Field(ge=0, le=1)
    autobiographical_evidence_threshold: int = Field(ge=2)
    schedule_interval_seconds: int = Field(ge=10)


class RetrievalSettings(_MemorySettings):
    token_budget: int = Field(ge=128)
    candidate_limit: int = Field(ge=1)
    result_limit: int = Field(ge=1)
    semantic_weight: float = Field(ge=0, le=1)


class MemorySettings(_MemorySettings):
    working: WorkingMemorySettings
    conversation: ConversationProjectionSettings
    experience: ExperienceSettings
    consolidation: ConsolidationSettings
    retrieval: RetrievalSettings


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
