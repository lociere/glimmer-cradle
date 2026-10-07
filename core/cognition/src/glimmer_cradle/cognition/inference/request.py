"""Provider-neutral inference request models."""

from __future__ import annotations

from dataclasses import dataclass, field

from glimmer_cradle.cognition.ports.capability_port import CapabilityResult


@dataclass(frozen=True, slots=True)
class ModelToolCall:
    call_id: str
    name: str
    arguments: dict[str, object]


@dataclass(frozen=True, slots=True)
class InferenceStep:
    """一次已完成推理及其真实结果；供应商续接格式由 Adapter 解释。"""

    text: str
    tool_calls: tuple[ModelToolCall, ...]
    results: tuple[CapabilityResult, ...]


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
    history: tuple[InferenceStep, ...] = ()
