"""Inference output and streaming events."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from glimmer_cradle.cognition.inference.model_descriptor import ModelTier


@dataclass(frozen=True, slots=True)
class InferenceResponse:
    text: str
    tier_used: ModelTier
    duration_ms: float = 0.0
    metadata: dict[str, object] = field(default_factory=dict)


class ModelEventKind(StrEnum):
    TEXT_DELTA = "text_delta"
    AUDIO_DELTA = "audio_delta"
    TOOL_CALL = "tool_call"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class ModelEvent:
    sequence: int
    kind: ModelEventKind
    payload: dict[str, Any] = field(default_factory=dict)
