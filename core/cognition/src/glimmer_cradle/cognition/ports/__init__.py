"""Cognition consumer-owned ports."""

from typing import Protocol

from glimmer_cradle.cognition.ports.capability_port import (
    CapabilityDescriptor,
    CapabilityInvocation,
    CapabilityPort,
    CapabilityResult,
    CapabilityResultStatus,
)
from glimmer_cradle.cognition.ports.clock_port import ClockPort
from glimmer_cradle.cognition.ports.content_port import ContentPort, ContentReference
from glimmer_cradle.cognition.ports.conversation_port import ConversationPort
from glimmer_cradle.cognition.ports.job_port import (
    JobPort,
    JobReceipt,
    JobRequest,
    JobRequestStatus,
)
from glimmer_cradle.cognition.ports.resource_port import ResourcePort, ResourceSnapshot


class IdGeneratorPort(Protocol):
    """生成不透明运行时标识和稳定派生标识。"""

    def new(self) -> str: ...
    def stable(self, namespace: str, value: str) -> str: ...

__all__ = [
    "CapabilityDescriptor",
    "CapabilityInvocation",
    "CapabilityPort",
    "CapabilityResult",
    "CapabilityResultStatus",
    "ClockPort",
    "ContentPort",
    "ContentReference",
    "ConversationPort",
    "JobPort",
    "JobReceipt",
    "JobRequest",
    "JobRequestStatus",
    "IdGeneratorPort",
    "ResourcePort",
    "ResourceSnapshot",
]
