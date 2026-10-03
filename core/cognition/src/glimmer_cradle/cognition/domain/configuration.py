"""Cognition 内部强类型配置投影；canonical defaults 只由 Kernel Schema normalizer 拥有。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field



class ConfigException(ValueError):
    """Kernel 规范化配置无法映射为 Cognition 投影。"""

    code = "CONFIG_ERROR"

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(f"[{self.code}] {message}")


class _Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)






class WorkingMemorySettings(_Settings):
    max_messages_per_conversation: int = Field(ge=2)
    hydrate_recent_messages: int = Field(ge=2)
    context_message_limit: int = Field(ge=1)


class ConversationProjectionSettings(_Settings):
    segment_target_messages: int = Field(ge=4)
    chapter_idle_minutes: int = Field(ge=1)
    chapter_segment_limit: int = Field(ge=2)
    state_update_messages: int = Field(ge=1)
    history_candidate_limit: int = Field(ge=1)
    history_result_limit: int = Field(ge=1)
    summary_max_chars: int = Field(ge=256)


class ExperienceSettings(_Settings):
    enabled: bool
    pack_max_size_mb: int = Field(ge=16)
    flush_interval_ms: int = Field(ge=50)
    flush_max_buffer: int = Field(ge=1)
    episode_idle_seconds: int = Field(ge=10)
    seal_integrity_check: bool


class ConsolidationSettings(_Settings):
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


class RetrievalSettings(_Settings):
    token_budget: int = Field(ge=128)
    candidate_limit: int = Field(ge=1)
    result_limit: int = Field(ge=1)
    semantic_weight: float = Field(ge=0, le=1)


class MemorySettings(_Settings):
    working: WorkingMemorySettings
    conversation: ConversationProjectionSettings
    experience: ExperienceSettings
    consolidation: ConsolidationSettings
    retrieval: RetrievalSettings


class CognitionSettings(_Settings):
    workspace_capacity: int = Field(ge=1)
    default_tick_interval_ms: int = Field(ge=1)


class EmbeddingRouteSettings(_Settings):
    provider: Literal["dashscope-text-embedding", "local-sentence-transformers"]


class DashScopeEmbeddingSettings(_Settings):
    endpoint: str
    model: str
    dimensions: Literal[64, 128, 256, 512, 768, 1024, 1536, 2048]
    request_timeout_ms: int = Field(ge=1000)
    max_retries: int = Field(ge=0, le=3)


class LocalEmbeddingSettings(_Settings):
    model_path: str
    model_id: str
    auto_download: bool
    device: str
    batch_size: int = Field(ge=1)


class EmbeddingProvidersSettings(_Settings):
    dashscope_text_embedding: DashScopeEmbeddingSettings = Field(
        validation_alias="dashscope-text-embedding"
    )
    local_sentence_transformers: LocalEmbeddingSettings = Field(
        validation_alias="local-sentence-transformers"
    )


class EmbeddingSettings(_Settings):
    enabled: bool
    route: EmbeddingRouteSettings
    providers: EmbeddingProvidersSettings
