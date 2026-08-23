"""文件型 telemetry 的显式 Observability Adapter。"""

from __future__ import annotations

from glimmer_cradle.cognition.adapters.observability import metrics, tracer
from glimmer_cradle.cognition.adapters.observability.logger import get_logger
from glimmer_cradle.cognition.adapters.observability.trace_context import (
    TraceContext,
    get_current_trace_id,
    new_trace_id,
)


class FileObservability:
    def logger(self, module_name: str):
        return get_logger(module_name)

    def counter(self, name: str, value: float = 1, labels: dict | None = None) -> None:
        metrics.counter(name, value, labels)

    def gauge(self, name: str, value: float, labels: dict | None = None) -> None:
        metrics.gauge(name, value, labels)

    def histogram(self, name: str, value: float, labels: dict | None = None) -> None:
        metrics.histogram(name, value, labels)

    def span(self, name: str, *, attributes: dict | None = None):
        return tracer.span(name, attributes=attributes)

    def trace_context(self, trace_id: str):
        return TraceContext(trace_id)

    def new_trace_id(self) -> str:
        return new_trace_id()

    def current_trace_id(self) -> str | None:
        return get_current_trace_id()
