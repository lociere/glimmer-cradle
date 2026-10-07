"""Consumer-owned port for capability exposure and durable invocation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol


@dataclass(frozen=True, slots=True)
class SkillReference:
    skill_id: str
    definition_revision: str

    def __post_init__(self) -> None:
        for value in (self.skill_id, self.definition_revision):
            if not isinstance(value, str) or not value.strip() or len(value.encode("utf-8")) > 4096:
                raise ValueError("invalid skill reference")


@dataclass(frozen=True, slots=True)
class SkillSummary:
    reference: SkillReference
    name: str
    description: str


@dataclass(frozen=True, slots=True)
class SkillMaterial:
    reference: SkillReference
    instructions: str


@dataclass(frozen=True, slots=True)
class CapabilityDescriptor:
    name: str
    description: str
    input_schema: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class CapabilityInvocation:
    run_id: str
    step: int
    call_id: str
    name: str
    arguments: dict[str, object]
    idempotency_key: str


CapabilityResultStatus = Literal["succeeded", "failed", "unknown"]


@dataclass(frozen=True, slots=True)
class CapabilityResult:
    call_id: str
    name: str
    status: CapabilityResultStatus
    output: object | None = None
    error: str | None = None


class CapabilityPort(Protocol):
    async def expose(self, *, scope: str) -> tuple[CapabilityDescriptor, ...]: ...

    async def invoke(self, invocation: CapabilityInvocation) -> CapabilityResult: ...
