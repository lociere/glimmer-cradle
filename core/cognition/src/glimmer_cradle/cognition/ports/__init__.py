"""Cognition consumer-owned ports."""

from contextlib import AbstractContextManager
from typing import Any, Protocol

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


class LoggerPort(Protocol):
    def debug(self, event: str, **values: Any) -> Any: ...
    def info(self, event: str, **values: Any) -> Any: ...
    def warning(self, event: str, **values: Any) -> Any: ...
    def error(self, event: str, **values: Any) -> Any: ...
    def critical(self, event: str, **values: Any) -> Any: ...


class SpanPort(Protocol):
    def set_attribute(self, name: str, value: Any) -> None: ...
    def add_event(self, name: str, attributes: dict | None = None) -> None: ...


class ObservabilityPort(Protocol):
    """由 Worker composition 创建并注入，不保存 process-global binding。"""

    def logger(self, module_name: str) -> LoggerPort: ...
    def counter(
        self, name: str, value: float = 1, labels: dict | None = None
    ) -> None: ...
    def gauge(self, name: str, value: float, labels: dict | None = None) -> None: ...
    def histogram(self, name: str, value: float, labels: dict | None = None) -> None: ...
    def span(
        self, name: str, *, attributes: dict | None = None
    ) -> AbstractContextManager[SpanPort]: ...
    def trace_context(self, trace_id: str) -> AbstractContextManager[Any]: ...
    def new_trace_id(self) -> str: ...
    def current_trace_id(self) -> str | None: ...

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
    "LoggerPort",
    "ObservabilityPort",
    "ResourcePort",
    "ResourceSnapshot",
    "SpanPort",
]
