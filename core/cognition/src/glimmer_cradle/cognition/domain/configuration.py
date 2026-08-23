"""Cognition 内部强类型配置投影；canonical defaults 只由 Kernel Schema normalizer 拥有。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class CharacterBaseSettings(_Settings):
    name: str
    nickname: str


class CharacterAssetsSettings(_Settings):
    root: str


class CharacterKnowledgeSettings(_Settings):
    index: str


class CharacterMigrationsSettings(_Settings):
    root: str


class CharacterManifestSettings(_Settings):
    character_id: str
    base: CharacterBaseSettings
    persona_mode: Literal["api", "local_base", "local_finetune"]
    assets: CharacterAssetsSettings
    knowledge: CharacterKnowledgeSettings
    migrations: CharacterMigrationsSettings


class ProfileTextEntrySettings(_Settings):
    id: str
    content: str
    priority: int
    enabled: bool


class ProfileConditionalEntrySettings(ProfileTextEntrySettings):
    condition: str


class ProfileIdentitySettings(_Settings):
    summary: str
    appearance: str
    values: list[ProfileTextEntrySettings]


class CharacterProfileSettings(_Settings):
    identity: ProfileIdentitySettings
    traits: list[ProfileTextEntrySettings]
    relationship: list[ProfileTextEntrySettings]
    expression: list[ProfileTextEntrySettings]
    emotion_behaviors: list[ProfileConditionalEntrySettings]
    context_behaviors: list[ProfileConditionalEntrySettings]
    examples: list[ProfileTextEntrySettings]


class DialoguePresentationSettings(_Settings):
    forbid_stage_directions: bool
    forbid_emotion_labels: bool
    casual_max_sentences: int
    casual_max_chars_per_message: int
    complex_reply_policy: str
    message_split_policy: str
    rules: list[str]


class StructuredOutputSettings(_Settings):
    preserve_markdown: bool
    preserve_code_blocks: bool
    require_fenced_code_blocks: bool
    rules: list[str]


class DialogueNormalizationSettings(_Settings):
    strip_stage_directions: bool
    strip_emotion_labels: bool


class DialoguePolicySettings(_Settings):
    presentation: DialoguePresentationSettings
    structured_output: StructuredOutputSettings
    normalization: DialogueNormalizationSettings


class SafetySettings(_Settings):
    taboos: str
    forbidden_phrases: list[str]
    forbidden_regex: list[str]


class ModelSettings(_Settings):
    max_tokens: int
    temperature: float
    top_p: float
    frequency_penalty: float


class LifeClockSettings(_Settings):
    heartbeat_enabled: bool
    heartbeat_interval_ms: int
    focus_duration_ms: int
    ingress_debounce_ms: int
    ingress_focused_debounce_ms: int
    ingress_max_batch_messages: int
    ingress_max_batch_items: int
    summon_keywords: list[str]
    focus_on_any_chat: bool


class MultimodalSettings(_Settings):
    enabled: bool
    strategy: Literal["core_direct", "specialist_then_core"]
    max_items: int
    core_model: str
    image_model: str
    video_model: str


class ActionStreamSettings(_Settings):
    enabled: bool
    channel: Literal["live2d"]


class InferenceSettings(_Settings):
    model: ModelSettings
    life_clock: LifeClockSettings
    multimodal: MultimodalSettings
    action_stream: ActionStreamSettings


class LLMRouteSettings(_Settings):
    provider: str | None = None
    model_alias: str | None = None


class LLMProviderSettings(_Settings):
    api_type: str
    api_key: str | None = None
    base_url: str | None = None
    models: dict[str, str]
    temperature: float | None = None
    request_method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] | None = None
    request_path: str | None = None
    request_headers: dict[str, str] | None = None
    request_body_template: str | None = None
    response_extract: str | None = None


class LLMSettings(_Settings):
    default_route: LLMRouteSettings | None = None
    api_type: str
    api_key: str | None = None
    base_url: str | None = None
    models: dict[str, str] | None = None
    temperature: float | None = None
    providers: dict[str, LLMProviderSettings] | None = None
    request_method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] | None = None
    request_path: str | None = None
    request_headers: dict[str, str] | None = None
    request_body_template: str | None = None
    response_extract: str | None = None


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


class CharacterRuntimeSettings(_Settings):
    manifest: CharacterManifestSettings
    profile: CharacterProfileSettings
    dialogue: DialoguePolicySettings
    safety: SafetySettings
    inference: InferenceSettings
    llm: LLMSettings | None = None
    memory: MemorySettings
    embedding: EmbeddingSettings
    cognition: CognitionSettings
