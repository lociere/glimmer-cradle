"""Model selection vocabulary and Cognition-owned inference policy."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

from glimmer_cradle.cognition.state import ModelTier


class _InferenceSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class ModelSettings(_InferenceSettings):
    max_tokens: int
    temperature: float
    top_p: float
    frequency_penalty: float


class LifeClockSettings(_InferenceSettings):
    heartbeat_enabled: bool
    heartbeat_interval_ms: int
    focus_duration_ms: int
    ingress_debounce_ms: int
    ingress_focused_debounce_ms: int
    ingress_max_batch_messages: int
    ingress_max_batch_items: int
    summon_keywords: list[str]
    focus_on_any_chat: bool


class MultimodalSettings(_InferenceSettings):
    enabled: bool
    strategy: Literal["core_direct", "specialist_then_core"]
    max_items: int
    core_model: str
    image_model: str
    video_model: str


class InferenceSettings(_InferenceSettings):
    model: ModelSettings
    life_clock: LifeClockSettings
    multimodal: MultimodalSettings


__all__ = [
    "InferenceSettings",
    "LifeClockSettings",
    "ModelSettings",
    "ModelTier",
    "MultimodalSettings",
]
