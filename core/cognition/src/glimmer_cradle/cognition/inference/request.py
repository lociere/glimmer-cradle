"""Provider-neutral inference request models."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class ModelMessage:
    role: str
    content: str
    vision_url: str | None = None
    vision_mime: str | None = None


@dataclass(frozen=True, slots=True)
class ModelRequest:
    messages: list[ModelMessage]
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class InferenceRequest:
    system: str
    user: str
    max_tokens: int = 512
    temperature: float = 0.7
    metadata: dict[str, object] = field(default_factory=dict)
    vision: tuple[tuple[str, str, str], ...] = ()
    provider_key: str | None = None
