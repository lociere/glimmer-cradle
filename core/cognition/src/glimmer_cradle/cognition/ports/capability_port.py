"""Consumer-owned port for capability exposure and durable invocation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol


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
