"""Cognition 可观测性薄门面。

核心作用：把遥测三支柱 ``log() / metric() / span()`` 统一在一个门面之下。
设计原则：
1. **薄门面**：不重写底层模块（logger/metrics/tracer），只是把它们的公开 API
   集中到 ``glimmer_cradle.cognition.observability`` 命名空间，调用方一个 import 就够。
2. **trace 上下文自动注入**：``log()`` 走 structlog（已有 processor 注入 trace
   上下文），``metric()`` / ``span()`` 已经在自己模块里读 contextvar —— 门面层
   只需透传，不引入新的隐式状态。
3. **既有调用方零侵入**：``get_logger`` / ``counter`` / ``gauge`` / ``histogram`` /
   ``span`` 等命名保留可直接 import；现有代码无须改写。

用法（推荐）::

    from glimmer_cradle.cognition.observability import telemetry

    log = telemetry.get_logger("chat_use_case")
    log.info("开始对话", scene_id=scene_id)

    with telemetry.span("memory.retrieve") as s:
        results = retrieve(query)
        s.set_attribute("hit_count", len(results))

    telemetry.counter("chat.calls")
    telemetry.gauge("emotion.intensity", 0.7, labels={"emotion": "happy"})
    telemetry.histogram("chat.duration_ms", duration)
"""
from __future__ import annotations

# ── 日志支柱 ① ────────────────────────────────────────────────────────────────
from glimmer_cradle.cognition.observability.logger import get_logger

# ── metrics 支柱 ② ────────────────────────────────────────────────────────────
from glimmer_cradle.cognition.observability.metrics import (
    MetricKind,
    counter,
    gauge,
    histogram,
    metric,
    start_metrics,
    stop_metrics,
)

# ── traces 支柱 ③ ─────────────────────────────────────────────────────────────
from glimmer_cradle.cognition.observability.tracer import (
    SpanEvent,
    span,
    start_tracer,
    stop_tracer,
    with_remote_parent_span,
)

# ── trace 上下文（boot / trace / span 三层；蓝图 §6.2）─────────────────────────
from glimmer_cradle.cognition.observability.trace_context import (
    TraceContext,
    get_current_boot_id,
    get_current_span_id,
    get_current_trace_id,
    new_boot_id,
    new_trace_id,
    set_boot_id,
)

__all__ = [
    # logs
    "get_logger",
    # metrics
    "MetricKind",
    "counter",
    "gauge",
    "histogram",
    "metric",
    "start_metrics",
    "stop_metrics",
    # traces
    "SpanEvent",
    "span",
    "start_tracer",
    "stop_tracer",
    "with_remote_parent_span",
    # trace 上下文
    "TraceContext",
    "get_current_boot_id",
    "get_current_span_id",
    "get_current_trace_id",
    "new_boot_id",
    "new_trace_id",
    "set_boot_id",
]
