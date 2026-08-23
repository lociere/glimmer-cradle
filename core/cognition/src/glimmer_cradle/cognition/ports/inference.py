"""LLM、Reasoning 与 Embedding 的真实外部能力边界。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol

import numpy as np

from glimmer_cradle.cognition.domain.activity.models import ModelTier


@dataclass(frozen=True, slots=True)
class LLMMessage:
    role: str
    content: str
    vision_url: str | None = None
    vision_mime: str | None = None


@dataclass(frozen=True, slots=True)
class LLMRequest:
    messages: list[LLMMessage]
    metadata: dict[str, object] = field(default_factory=dict)


class LLMPort(Protocol):
    def generate(self, request: LLMRequest, provider_key: str | None = None) -> str: ...


@dataclass(frozen=True, slots=True)
class ReasoningRequest:
    system: str
    user: str
    max_tokens: int = 512
    temperature: float = 0.7
    metadata: dict[str, object] = field(default_factory=dict)
    vision: tuple[tuple[str, str, str], ...] = ()
    provider_key: str | None = None


@dataclass(frozen=True, slots=True)
class ReasoningResponse:
    text: str
    tier_used: ModelTier
    duration_ms: float = 0.0
    metadata: dict[str, object] = field(default_factory=dict)


class ReasoningBackendPort(Protocol):
    async def generate(self, request: ReasoningRequest) -> ReasoningResponse: ...


EmbeddingTextType = Literal["query", "document"]


class EmbeddingPort(Protocol):
    @property
    def model_id(self) -> str: ...
    def is_available(self) -> bool: ...
    async def encode(self, texts: list[str], *, text_type: EmbeddingTextType) -> np.ndarray: ...
    async def encode_single(self, text: str, *, text_type: EmbeddingTextType) -> np.ndarray: ...
    def cosine_similarities(self, query: np.ndarray, matrix: np.ndarray) -> np.ndarray: ...
