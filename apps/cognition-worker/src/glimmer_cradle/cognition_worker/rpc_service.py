"""Cognition Worker RPC process and lifecycle supervision."""
from __future__ import annotations

import argparse
import asyncio
import base64
import contextvars
import hashlib
import hmac
import json
import logging
import os
import re
import sys
import threading
import time
import uuid
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Final, Optional

import grpc
import structlog
from glimmer.capabilities.v1 import capabilities_pb2 as capabilities_pb
from glimmer.cognition.v1 import cognition_service_pb2 as cognition_pb
from glimmer.common.v1 import service_contract_pb2 as common_pb
from glimmer.conversation.v1 import conversation_pb2 as conversation_pb
from glimmer.jobs.v1 import jobs_pb2 as jobs_pb
from glimmer.kernel.v1 import kernel_control_service_pb2 as kernel_pb
from glimmer_cradle.cognition.attention import AttentionController
from glimmer_cradle.cognition.loop import LoopController
from glimmer_cradle.cognition.memory import (
    ConsolidationCoordinator,
    MemoryConsolidationConflictError,
    MemoryConsolidationInput,
    MemoryConsolidationReceipt,
    MemoryConsolidationRequest,
    MemoryJobFeedback,
    MemoryJobIdentity,
    MemoryJobResult,
)
from glimmer_cradle.cognition.perception import (
    ObservationQueue,
    PerceptionOperationConflict,
    PerceptionOperationRegistry,
)
from glimmer_cradle.cognition.planning import PlanningConflictError, PlanningStore
from glimmer_cradle.cognition.ports import (
    JobReceipt,
    KernelRequestPort,
)
from glimmer_cradle.cognition.state import CognitiveActivityController
from glimmer_cradle.cognition_worker.adapters.cognition_mapper import (
    agent_plan_from_wire,
    agent_plan_to_wire,
    agent_synthesis_from_wire,
    agent_synthesis_to_wire,
    knowledge_initialization_from_wire,
    observation_from_wire,
)
from glimmer_cradle.cognition_worker.adapters.conversation_mapper import (
    execution_result_from_wire,
    history_query_from_wire,
    history_result_to_wire,
)
from glimmer_cradle.cognition_worker.adapters.job_client import (
    planning_source_from_wire,
    planning_source_to_wire,
)
from glimmer_cradle.cognition_worker.composition import WorkerPaths
from glimmer_cradle.cognition_worker.readiness import (
    WORKER_READY_COMPONENTS,
    ReadinessTracker,
)
from glimmer_cradle.cognition_worker.shutdown import (
    ShutdownCoordinator,
    cancel_task,
    worker_shutdown_steps,
)
from glimmer_cradle.conversation import ConversationRecorder
from google.protobuf.json_format import MessageToDict, ParseDict
from structlog.stdlib import ProcessorFormatter


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path

_trace_id_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "cognition_trace_id", default=None
)


def get_current_trace_id() -> Optional[str]:
    """返回当前协程上下文中的 trace_id；未设置返回 None。"""
    return _trace_id_var.get()


def set_current_trace_id(trace_id: Optional[str]) -> contextvars.Token:
    """直接设置 trace_id，返回 token；调用方负责在合适时机调用 reset。

    通常优先使用 :class:`TraceContext` 上下文管理器，保证异常路径也能还原。
    """
    return _trace_id_var.set(trace_id)


def reset_trace_id(token: contextvars.Token) -> None:
    """还原到 token 之前的状态。"""
    _trace_id_var.reset(token)


def new_trace_id() -> str:
    """生成新的 trace_id（UUIDv4，无连字符前缀）。

    用于系统自发性事件（如生命时钟唤醒、定时任务）这种没有上游 trace_id 的入口。
    """
    return uuid.uuid4().hex


# ──────────────────────────────────────────────────────────────────────────────
# 三层 trace（Glimmer Cradle 架构蓝图 §6.2）
# ──────────────────────────────────────────────────────────────────────────────
#
# telemetry 层只关心三层，从粗到细：
#   boot_id     一次进程启动周期 —— 进程级，启动时设定一次
#                （参考 Linux systemd boot_id 约定；不承载"清醒/心境"的认知含义）
#   trace_id    一次跨层因果链关联 —— 协程级（W3C TraceContext 对齐）
#   span_id     trace 内一个原子操作 —— 协程级（OTel Span 对齐）
#
# boot_id 是进程级常量，用模块级持有；trace / span 是协程级，用 contextvar。
# 认知主体的"清醒/心境/经历"语义不在此层 —— 见 experience/events.py 的 Moment。

_boot_id: Optional[str] = None

_span_id_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "cognition_span_id", default=None
)


def new_boot_id() -> str:
    """生成新的 boot_id（UUIDv4 hex）。"""
    return uuid.uuid4().hex


def set_boot_id(boot_id: str) -> None:
    """设定进程级 boot_id（通常在 main 启动时调用一次）。"""
    global _boot_id
    _boot_id = boot_id


def get_current_boot_id() -> Optional[str]:
    """返回当前进程的 boot_id；未设定返回 None。"""
    return _boot_id


def set_current_span_id(span_id: Optional[str]) -> contextvars.Token:
    """设置当前协程的 span_id，返回 token；调用方负责 reset。"""
    return _span_id_var.set(span_id)


def get_current_span_id() -> Optional[str]:
    """返回当前协程的 span_id；未设置返回 None。"""
    return _span_id_var.get()


# ──────────────────────────────────────────────────────────────────────────────
# 上下文管理器
# ──────────────────────────────────────────────────────────────────────────────


class TraceContext:
    """``with`` 上下文管理器：进入时设置 trace_id，退出时还原（含异常路径）。

    用法::

        with TraceContext(event.trace_id):
            await process_event(event)
            # 这里发出的所有日志自动带 trace_id

    嵌套使用时遵循栈语义：内层覆盖外层，退出后还原到外层值。
    """

    __slots__ = ("trace_id", "_token")

    def __init__(self, trace_id: str) -> None:
        if not trace_id:
            raise ValueError("trace_id 不能为空；如需自动生成请使用 new_trace_id()")
        self.trace_id: str = trace_id
        self._token: Optional[contextvars.Token] = None

    def __enter__(self) -> "TraceContext":
        self._token = _trace_id_var.set(self.trace_id)
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if self._token is not None:
            _trace_id_var.reset(self._token)
            self._token = None


# ──────────────────────────────────────────────────────────────────────────────
# 合成 trace_id（无上游入口的占位）
# ──────────────────────────────────────────────────────────────────────────────

# 每模块独立计数器，用于 boot_id 尚未确立时（启动早期）的占位
_synthetic_counters: dict[str, int] = {}
# boot_id 确立后的全局占位计数器
_boot_synthetic_counter: int = 0


def _next_synthetic_trace_id(module_name: str) -> str:
    """生成无上游 trace_id 时的占位（系统自发事件：启动序列、定时任务、心跳等）。

    - boot_id 已确立 → ``run-{boot_id}-{n}``：与本次启动周期绑定，跨 run 不会撞。
    - boot_id 尚未确立（启动极早期）→ ``synthetic-{module}-{n}``：按模块对齐。

    见 docs/architecture/blueprint/微光摇篮架构蓝图.md §6.2 / docs/architecture/current/log-fields-glossary.md §5.4。
    """
    global _boot_synthetic_counter
    if _boot_id:
        _boot_synthetic_counter += 1
        return f"run-{_boot_id}-{_boot_synthetic_counter}"
    n = _synthetic_counters.get(module_name, 0) + 1
    _synthetic_counters[module_name] = n
    return f"synthetic-{module_name}-{n}"


# ──────────────────────────────────────────────────────────────────────────────
# structlog processor
# ──────────────────────────────────────────────────────────────────────────────


def trace_context_processor(_logger: Any, _method: str, event_dict: dict) -> dict:
    """structlog processor：把 trace 上下文注入 event_dict。

    注入字段（Glimmer Cradle 架构蓝图 §6.2）：
      - boot_id —— 进程级，存在即注入
      - trace_id —— 协程级；缺失时合成 run-/synthetic- 占位
      - span_id —— 协程级；存在才注入（多数日志无 span）

    各字段若调用方已显式传入则不覆盖。
    """
    if _boot_id and "boot_id" not in event_dict:
        event_dict["boot_id"] = _boot_id

    span = _span_id_var.get()
    if span and "span_id" not in event_dict:
        event_dict["span_id"] = span

    if "trace_id" not in event_dict:
        current = _trace_id_var.get()
        if current is not None:
            event_dict["trace_id"] = current
        else:
            module = event_dict.get("module") or event_dict.get("logger") or "unknown"
            event_dict["trace_id"] = _next_synthetic_trace_id(str(module))
    return event_dict


def _normalize_timestamp_precision(_logger, _method, event_dict):
    """把 ISO timestamp 从 microsecond 精度截断到 millisecond。

    structlog TimeStamper(fmt='iso') 输出形如 '2026-05-08T07:03:33.522226Z'，
    Python isoformat 默认 6 位小数。我们截断到 3 位以与 TypeScript 端 ms 精度对齐。
    """
    ts = event_dict.get("timestamp")
    if isinstance(ts, str) and "." in ts:
        # 形如 "2026-05-08T07:03:33.522226Z" 或 "2026-05-08T07:03:33.522226"
        head, _, tail = ts.partition(".")
        # 提取小数部分（保留 3 位）+ 时区/Z 后缀
        digits = ""
        suffix = ""
        for i, ch in enumerate(tail):
            if ch.isdigit():
                digits += ch
            else:
                suffix = tail[i:]
                break
        truncated = digits[:3].ljust(3, "0")
        event_dict["timestamp"] = f"{head}.{truncated}{suffix}"
    return event_dict


def _normalize_level_name(_logger, _method, event_dict):
    """把 Python stdlib 的 ``warning`` 映射为协议规定的 ``warn``。"""
    level = event_dict.get("level")
    if level == "warning":
        event_dict["level"] = "warn"
    return event_dict

# ──────────────────────────────────────────────────────────────────────────────
# 幂等保护
# ──────────────────────────────────────────────────────────────────────────────
_initialized: bool = False

# ──────────────────────────────────────────────────────────────────────────────
# 共享预处理链
#   文件 formatter、控制台 formatter、以及 structlog.configure 三处共用同一组处理器
#   执行顺序：日志级别 → 记录器名称 → 时间戳 → trace_id → 调用栈 → 异常信息
# ──────────────────────────────────────────────────────────────────────────────
_PRE_CHAIN: list = [
    structlog.stdlib.add_log_level,       # 注入 level 字段
    _normalize_level_name,                # warning → warn（与 TS 对齐）
    structlog.stdlib.add_logger_name,     # 注入 logger 字段
    structlog.processors.TimeStamper(fmt="iso"),
    _normalize_timestamp_precision,       # μs → ms（与 TS 对齐）
    trace_context_processor,              # 自动注入四层 trace 上下文（来自 contextvar）
    structlog.processors.StackInfoRenderer(),
    structlog.processors.ExceptionRenderer(),   # 替代已废弃的 format_exc_info
]


# ──────────────────────────────────────────────────────────────────────────────
# Formatter 工厂
# ──────────────────────────────────────────────────────────────────────────────

def _make_json_formatter() -> ProcessorFormatter:
    """JSON formatter —— 用于文件 handler，始终输出机器可读的 JSON 行。"""
    return ProcessorFormatter(
        foreign_pre_chain=_PRE_CHAIN,
        processors=[
            ProcessorFormatter.remove_processors_meta,
            structlog.processors.JSONRenderer(),
        ],
    )


def _make_console_formatter() -> ProcessorFormatter:
    """
    控制台 formatter —— 输出格式由 PRETTY_LOGS 环境变量决定：
      PRETTY_LOGS=1   彩色可读格式（开发调试用）
      默认            纯 JSON（生产 / Kernel 内核读取 stdout 解析用）
    """
    pretty = os.environ.get("PRETTY_LOGS", "").lower() in ("1", "true", "yes")
    renderer = (
        structlog.dev.ConsoleRenderer(colors=True)
        if pretty
        else structlog.processors.JSONRenderer()
    )
    return ProcessorFormatter(
        foreign_pre_chain=_PRE_CHAIN,
        processors=[
            ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
    )


# ──────────────────────────────────────────────────────────────────────────────
# 未捕获异常 hook
# ──────────────────────────────────────────────────────────────────────────────

def _install_excepthook() -> None:
    """将所有未处理的同步异常写入日志系统，避免静默崩溃。"""
    _crash_logger = logging.getLogger("glimmer_cradle.cognition.crash")

    def _handler(
        exc_type: type[BaseException],
        exc_value: BaseException,
        exc_tb: Any,
    ) -> None:
        # KeyboardInterrupt 保持默认行为（Ctrl-C 正常退出）
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc_value, exc_tb)
            return
        _crash_logger.critical(
            "未捕获的全局异常，程序即将退出",
            exc_info=(exc_type, exc_value, exc_tb),
        )

    sys.excepthook = _handler


# ──────────────────────────────────────────────────────────────────────────────
# stdlib logging 配置
# ──────────────────────────────────────────────────────────────────────────────

def _resolve_log_dir() -> Path:
    """解析日志目录，优先使用 Kernel 内核注入的 LOG_DIR 环境变量。"""
    env_dir = os.environ.get("LOG_DIR")
    if env_dir:
        return ensure_dir(Path(env_dir))
    return ensure_dir(WorkerPaths.from_environment().observability_dir / "logs")


def _configure_std_logging() -> None:
    """配置 stdlib 根日志器（幂等）。"""
    global _initialized
    if _initialized:
        return
    _initialized = True

    log_dir = _resolve_log_dir()
    level_name = os.environ.get("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()

    # Provider URL 可含凭据；请求状态由安全的 invocation 记录，不输出第三方 wire 日志。
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    # ── 控制台 handler（写入 stdout，被 Kernel 内核捕获）
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setLevel(level)
    stream_handler.setFormatter(_make_console_formatter())

    root.addHandler(stream_handler)

    # 默认仅通过 stdout 输出，由 Kernel 统一汇总进进程日志。
    # 如需 Python 侧独立文件日志，可设置 PYTHON_FILE_LOGGING=1。
    enable_file_logging = os.environ.get("PYTHON_FILE_LOGGING", "0").lower() in ("1", "true", "yes")
    if enable_file_logging:
        application_log_dir = ensure_dir(log_dir / "application")
        main_handler = RotatingFileHandler(
            filename=str(application_log_dir / "cognition.jsonl"),
            maxBytes=10 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
        )
        main_handler.setLevel(level)
        main_handler.setFormatter(_make_json_formatter())

        error_handler = RotatingFileHandler(
            filename=str(application_log_dir / "cognition.errors.jsonl"),
            maxBytes=5 * 1024 * 1024,
            backupCount=3,
            encoding="utf-8",
        )
        error_handler.setLevel(logging.WARNING)
        error_handler.setFormatter(_make_json_formatter())

        root.addHandler(main_handler)
        root.addHandler(error_handler)

    _install_excepthook()


# ──────────────────────────────────────────────────────────────────────────────
# structlog 配置
# ──────────────────────────────────────────────────────────────────────────────

def _configure_structlog() -> None:
    """
    将 structlog 与 stdlib logging 深度集成（ProcessorFormatter 模式）。
    chain 末尾的 wrap_for_formatter 将事件字典交由各 handler 的 ProcessorFormatter 渲染，
    从而实现文件与控制台各自独立的输出格式。
    """
    structlog.configure(
        processors=[
            *_PRE_CHAIN,
            ProcessorFormatter.wrap_for_formatter,
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )


# ──────────────────────────────────────────────────────────────────────────────
# 模块加载时立即初始化
# ──────────────────────────────────────────────────────────────────────────────
_configure_std_logging()
_configure_structlog()

_root_logger = structlog.get_logger("glimmer_cradle.cognition")


def get_logger(module_name: str) -> Any:
    """返回绑定了 module 字段的结构化日志器。"""
    return _root_logger.bind(module=module_name)


class MetricKind(StrEnum):
    """观测 adapter 接受的指标事件类型。"""

    COUNTER = "counter"
    GAUGE = "gauge"
    HISTOGRAM = "histogram"

metrics_logger = get_logger("metrics")

_METRIC_LABEL_ALLOWLIST = {
    "action",
    "backend",
    "capability_kind",
    "emotion",
    "error_code",
    "error_kind",
    "from",
    "module",
    "op",
    "owner",
    "phase",
    "process_kind",
    "provider",
    "provider_id",
    "provider_kind",
    "purpose",
    "reason",
    "risk_level",
    "scene_kind",
    "source",
    "state",
    "status",
    "target_kind",
    "target_name",
    "tier",
    "tool_name",
    "to",
}


def _metric_now_iso_ms() -> str:
    """UTC 毫秒 ISO8601 时间戳。"""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class MetricEvent:
    """一条 metric 事件。"""

    ts: str
    name: str
    kind: str
    value: float
    labels: dict = field(default_factory=dict)
    trace_id: str = ""
    boot_id: str | None = None

    def to_jsonl(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, default=str)


class MetricsWriter:
    """metrics 事件的 append-only JSONL 写入器。异步缓冲，后台批量落盘。"""

    def __init__(
        self,
        metrics_dir: Path,
        *,
        proc: str = "python",
        flush_interval_ms: int = 2000,
        segment_max_bytes: int = 8 * 1024 * 1024,
    ) -> None:
        self._dir = metrics_dir
        self._path = metrics_dir / f"{proc}.jsonl"
        self._flush_interval = max(0.1, flush_interval_ms / 1000.0)
        self._segment_max_bytes = segment_max_bytes
        self._buffer: list[MetricEvent] = []
        self._task: asyncio.Task | None = None
        self._running = False
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        self._running = True
        self._task = asyncio.create_task(self._flush_loop())
        metrics_logger.info("metrics 写入器已启动", path=str(self._path))

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self.flush()
        metrics_logger.info("metrics 写入器已停止")

    def append(self, event: MetricEvent) -> None:
        """入缓冲（廉价同步操作）。"""
        self._buffer.append(event)

    async def flush(self) -> None:
        async with self._lock:
            if not self._buffer:
                return
            pending, self._buffer = self._buffer, []
        await asyncio.to_thread(self._write_batch, pending)

    def _write_batch(self, pending: list[MetricEvent]) -> None:
        self._maybe_rotate()
        with open(self._path, "a", encoding="utf-8") as f:
            for event in pending:
                f.write(event.to_jsonl() + "\n")

    def _maybe_rotate(self) -> None:
        """文件超过阈值则改名归档，重新开新文件。"""
        try:
            if self._path.exists() and self._path.stat().st_size >= self._segment_max_bytes:
                archived = self._path.with_name(f"{self._path.name}.{int(time.time())}")
                self._path.rename(archived)
        except OSError as exc:
            metrics_logger.warning("metrics 文件轮转失败", error=str(exc))

    async def _flush_loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(self._flush_interval)
                await self.flush()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                metrics_logger.error("metrics flush 异常", error=str(exc), exc_info=True)


# ── 模块级门面：全进程唯一写入器 ──────────────────────────────────────────────

_metrics_writer: MetricsWriter | None = None


async def start_metrics(metrics_dir: Path, *, proc: str = "cognition") -> None:
    """启动 metrics 写入器（由 CognitionHost 启动序列调用）。"""
    global _metrics_writer
    if _metrics_writer is not None:
        return
    _metrics_writer = MetricsWriter(metrics_dir, proc=proc)
    await _metrics_writer.start()


async def stop_metrics() -> None:
    """停止 metrics 写入器（落盘剩余缓冲）。"""
    global _metrics_writer
    if _metrics_writer is not None:
        await _metrics_writer.stop()
        _metrics_writer = None


def metric(name: str, kind: MetricKind | str, value: float, labels: dict | None = None) -> None:
    """记录一条 metric。未启动时为无操作 —— 自动带 boot/trace 上下文。"""
    if _metrics_writer is None:
        return
    _metrics_writer.append(MetricEvent(
        ts=_metric_now_iso_ms(),
        name=name,
        kind=kind.value if isinstance(kind, MetricKind) else str(kind),
        value=float(value),
        labels=sanitize_metric_labels(name, labels or {}),
        trace_id=get_current_trace_id() or "",
        boot_id=get_current_boot_id(),
    ))


def counter(name: str, value: float = 1, labels: dict | None = None) -> None:
    """累加计数（调用次数、错误数等）。"""
    metric(name, MetricKind.COUNTER, value, labels)


def gauge(name: str, value: float, labels: dict | None = None) -> None:
    """瞬时值（情绪强度、记忆条数等）。"""
    metric(name, MetricKind.GAUGE, value, labels)


def histogram(name: str, value: float, labels: dict | None = None) -> None:
    """分布采样（延迟、耗时、token 数等）。"""
    metric(name, MetricKind.HISTOGRAM, value, labels)


def sanitize_metric_labels(name: str, labels: dict[str, str]) -> dict[str, str]:
    sanitized: dict[str, str] = {}
    for key, value in labels.items():
        if key not in _METRIC_LABEL_ALLOWLIST:
            metrics_logger.warning("metrics label 已丢弃（不在白名单）", metric_name=name, label_key=key)
            continue
        sanitized[key] = value
    return sanitized


tracer_logger = get_logger("tracer")


def _span_now_iso_ms() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _new_span_id() -> str:
    """生成新的 span_id（OTel 通常 16 hex chars；这里取 UUID 前 16）。"""
    return uuid.uuid4().hex[:16]


@dataclass(frozen=True)
class SpanEvent:
    """一个完成的 span —— 结构对齐 OTel Span（精简版）。"""

    name: str
    trace_id: str
    span_id: str
    parent_span_id: str | None
    started_at: str            # ISO ms
    ended_at: str              # ISO ms
    duration_ms: float
    status: str                # ok | error
    attributes: dict = field(default_factory=dict)
    error: str | None = None
    boot_id: str | None = None

    def to_jsonl(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, default=str)


class SpanWriter:
    """span 事件的 append-only JSONL 写入器（与 metrics 写入器同构）。"""

    def __init__(
        self,
        traces_dir: Path,
        *,
        proc: str = "python",
        flush_interval_ms: int = 2000,
        segment_max_bytes: int = 8 * 1024 * 1024,
    ) -> None:
        self._dir = traces_dir
        self._path = traces_dir / f"{proc}.jsonl"
        self._flush_interval = max(0.1, flush_interval_ms / 1000.0)
        self._segment_max_bytes = segment_max_bytes
        self._buffer: list[SpanEvent] = []
        self._task: asyncio.Task | None = None
        self._running = False
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        self._running = True
        self._task = asyncio.create_task(self._flush_loop())
        tracer_logger.info("span 写入器已启动", path=str(self._path))

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self.flush()
        tracer_logger.info("span 写入器已停止")

    def append(self, event: SpanEvent) -> None:
        self._buffer.append(event)

    async def flush(self) -> None:
        async with self._lock:
            if not self._buffer:
                return
            pending, self._buffer = self._buffer, []
        await asyncio.to_thread(self._write_batch, pending)

    def _write_batch(self, pending: list[SpanEvent]) -> None:
        self._maybe_rotate()
        with open(self._path, "a", encoding="utf-8") as f:
            for event in pending:
                f.write(event.to_jsonl() + "\n")

    def _maybe_rotate(self) -> None:
        try:
            if self._path.exists() and self._path.stat().st_size >= self._segment_max_bytes:
                archived = self._path.with_name(f"{self._path.name}.{int(time.time())}")
                self._path.rename(archived)
        except OSError as exc:
            tracer_logger.warning("span 文件轮转失败", error=str(exc))

    async def _flush_loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(self._flush_interval)
                await self.flush()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                tracer_logger.error("span flush 异常", error=str(exc), exc_info=True)


# ── 模块级门面：全进程唯一写入器 ──────────────────────────────────────────────

_span_writer: SpanWriter | None = None


async def start_tracer(traces_dir: Path, *, proc: str = "cognition") -> None:
    """启动 span 写入器（由 CognitionHost 启动序列调用）。"""
    global _span_writer
    if _span_writer is not None:
        return
    _span_writer = SpanWriter(traces_dir, proc=proc)
    await _span_writer.start()


async def stop_tracer() -> None:
    """停止 span 写入器（落盘剩余缓冲）。"""
    global _span_writer
    if _span_writer is not None:
        await _span_writer.stop()
        _span_writer = None


class span:
    """``with`` 上下文管理器：开启一个 span。

    用法::

        with span("llm.generate", attributes={"model": "gpt-4"}) as s:
            result = call_llm(...)
            s.set_attribute("tokens", result.tokens)

    - 父 span：当前 contextvar 中的 span_id（如有），否则为 None（根 span）。
    - trace_id：当前 contextvar 中的 trace_id；缺失时合成一个新 trace 头。
    - 异常路径：自动标记 status=error，并把异常类名写入 ``error`` 字段。
    """

    __slots__ = ("name", "_attrs", "_span_id", "_trace_id", "_parent", "_started_at",
                 "_started_mono", "_span_token", "_trace_token", "_status", "_error")

    def __init__(self, name: str, *, attributes: dict | None = None) -> None:
        self.name = name
        self._attrs: dict = dict(attributes or {})
        self._span_id: str = _new_span_id()
        self._trace_id: str = ""
        self._parent: str | None = None
        self._started_at: str = ""
        self._started_mono: float = 0.0
        self._span_token: Any = None
        self._trace_token: Any = None
        self._status: str = "ok"
        self._error: str | None = None

    @property
    def span_id(self) -> str:
        return self._span_id

    @property
    def trace_id(self) -> str:
        return self._trace_id

    def set_attribute(self, key: str, value: Any) -> None:
        """在 span 完成前追加属性（OTel `setAttribute` 等价）。"""
        self._attrs[key] = value

    def set_status(self, status: str, error: str | None = None) -> None:
        """显式标记 span 状态。"""
        self._status = status
        if error is not None:
            self._error = error

    def __enter__(self) -> "span":
        # 父 span：当前 contextvar
        self._parent = get_current_span_id()
        # trace_id：当前 contextvar；无则新建（根 span 自带新 trace）
        current_trace = get_current_trace_id()
        if current_trace is None:
            self._trace_id = new_trace_id()
            self._trace_token = _trace_id_var.set(self._trace_id)
        else:
            self._trace_id = current_trace
        self._span_token = _span_id_var.set(self._span_id)
        self._started_at = _span_now_iso_ms()
        self._started_mono = time.monotonic()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        duration_ms = (time.monotonic() - self._started_mono) * 1000.0
        if exc_type is not None and self._status == "ok":
            self._status = "error"
            self._error = exc_type.__name__
        ended_at = _span_now_iso_ms()
        if _span_writer is not None:
            _span_writer.append(SpanEvent(
                name=self.name,
                trace_id=self._trace_id,
                span_id=self._span_id,
                parent_span_id=self._parent,
                started_at=self._started_at,
                ended_at=ended_at,
                duration_ms=duration_ms,
                status=self._status,
                attributes=self._attrs,
                error=self._error,
                boot_id=get_current_boot_id(),
            ))
        # 还原 contextvar（异常路径也保证还原）
        if self._span_token is not None:
            _span_id_var.reset(self._span_token)
            self._span_token = None
        if self._trace_token is not None:
            _trace_id_var.reset(self._trace_token)
            self._trace_token = None


class with_remote_parent_span:
    """IPC 入站用：把信封里携带的 trace_id + span_id 建为本协程的父上下文。

    用法（在 ingress 处）::

        with with_remote_parent_span(envelope.trace_id, envelope.span_id or None):
            # 这里 `with span("...")` 开出来的 span 会自动挂到远端父 span 下
            await handler(envelope)
    """

    __slots__ = ("_trace_id", "_parent_span_id", "_trace_token", "_span_token")

    def __init__(self, trace_id: str, parent_span_id: str | None) -> None:
        if not trace_id:
            raise ValueError("trace_id 不能为空")
        self._trace_id = trace_id
        self._parent_span_id = parent_span_id
        self._trace_token: Any = None
        self._span_token: Any = None

    def __enter__(self) -> "with_remote_parent_span":
        self._trace_token = _trace_id_var.set(self._trace_id)
        if self._parent_span_id:
            self._span_token = _span_id_var.set(self._parent_span_id)
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if self._span_token is not None:
            _span_id_var.reset(self._span_token)
            self._span_token = None
        if self._trace_token is not None:
            _trace_id_var.reset(self._trace_token)
            self._trace_token = None


class FileObservability:
    def logger(self, module_name: str):
        return get_logger(module_name)

    def counter(self, name: str, value: float = 1, labels: dict | None = None) -> None:
        counter(name, value, labels)

    def gauge(self, name: str, value: float, labels: dict | None = None) -> None:
        gauge(name, value, labels)

    def histogram(self, name: str, value: float, labels: dict | None = None) -> None:
        histogram(name, value, labels)

    def span(self, name: str, *, attributes: dict | None = None):
        return span(name, attributes=attributes)

    def trace_context(self, trace_id: str):
        return TraceContext(trace_id)

    def new_trace_id(self) -> str:
        return new_trace_id()

    def current_trace_id(self) -> str | None:
        return get_current_trace_id()


invocation_logger = get_logger("model_invocations")

_SECRET_KEYWORDS = ("api_key", "authorization", "token", "secret")
_SECRET_PATTERNS = [
    (re.compile(r"Bearer\s+[A-Za-z0-9._-]+", re.IGNORECASE), "Bearer [REDACTED]"),
    (re.compile(r"sk-[A-Za-z0-9_-]+"), "[REDACTED_API_KEY]"),
]
_ARTIFACT_WRITE_LOCK = threading.Lock()
_SEQUENCE_PREFIX = re.compile(r"^(\d{3,})_")
_ARTIFACT_CATEGORY_DIRECTORIES = {
    "decision": "01-action-decision",
    "skill": "02-skill-planning",
    "response": "03-final-response",
    "memory": "04-memory",
    "other": "99-other",
}


@dataclass(frozen=True)
class ModelInvocationSettings:
    capture_mode: str = "summary"
    full_retention_days: int = 3
    redact_secrets: bool = True


def record_model_invocation(
    *,
    invocation_id: str,
    purpose: str,
    capture_category: str,
    provider_id: str,
    model_id: str,
    prompt_text: str,
    normalized_text: str,
    duration_ms: float,
    outcome: str,
    scene_id: str | None = None,
    module: str = "inference",
    owner: str = "cognition",
    runtime_id: str = "cognition",
    provider_payload: Any = None,
    raw_response: Any = None,
    error_code: str | None = None,
    error_summary: str | None = None,
    attributes: dict[str, Any] | None = None,
    trace_id: str | None = None,
) -> dict[str, Any] | None:
    settings = load_model_invocation_settings()
    if settings.capture_mode == "off":
        return None

    invocation_dir = _resolve_model_invocations_dir()
    ensure_dir(invocation_dir)
    record: dict[str, Any] = {
        "timestamp": _now_iso(),
        "invocation_id": invocation_id,
        "capture_mode": settings.capture_mode,
        "purpose": purpose or "unspecified",
        "capture_category": _normalize_capture_category(capture_category),
        "owner": owner,
        "module": module,
        "runtime_id": runtime_id,
        "trace_id": trace_id or get_current_trace_id() or "",
        "span_id": get_current_span_id(),
        "scene_id": scene_id or None,
        "provider_id": provider_id,
        "model_id": model_id,
        "outcome": outcome,
        "duration_ms": round(max(duration_ms, 0.0), 3),
        "prompt_chars": len(prompt_text),
        "response_chars": len(normalized_text),
        "prompt_hash": _hash_text(prompt_text),
        "response_hash": _hash_text(normalized_text),
        "provider_payload_ref": None,
        "raw_response_ref": None,
        "prompt_text_ref": None,
        "response_text_ref": None,
        "normalized_text_ref": None,
        "error_code": error_code,
        "error_summary": _redact_text(error_summary) if error_summary else None,
        "redacted": settings.redact_secrets,
        "schema_version": "2.0.0",
        "attributes": _redact_json(attributes or {}) if settings.redact_secrets else (attributes or {}),
    }

    if settings.capture_mode == "full":
        _write_full_capture_bundle(
            record=record,
            prompt_text=prompt_text,
            normalized_text=normalized_text,
            provider_payload=provider_payload,
            raw_response=raw_response,
            redact=settings.redact_secrets,
        )

    _append_jsonl(invocation_dir / "records" / "cognition.jsonl", record)
    return record


def load_model_invocation_settings() -> ModelInvocationSettings:
    raw = os.environ.get("GLIMMER_CRADLE_OBSERVABILITY")
    if not raw:
        return ModelInvocationSettings()
    try:
        payload = json.loads(raw)
        capture = payload.get("model_invocations") if isinstance(payload, dict) else None
        if not isinstance(capture, dict):
            return ModelInvocationSettings()
        capture_mode = str(capture.get("capture_mode") or "summary").strip() or "summary"
        if capture_mode not in {"off", "summary", "full"}:
            capture_mode = "summary"
        full_retention_days = int(capture.get("full_retention_days") or 3)
        redact_secrets = bool(capture.get("redact_secrets", True))
        return ModelInvocationSettings(
            capture_mode=capture_mode,
            full_retention_days=max(full_retention_days, 1),
            redact_secrets=redact_secrets,
        )
    except Exception as exc:
        invocation_logger.warning("读取模型调用观测配置失败，回退默认值", error=str(exc))
        return ModelInvocationSettings()


def _resolve_model_invocations_dir() -> Path:
    configured = os.environ.get("GLIMMER_CRADLE_OBSERVABILITY_DIR")
    if configured:
        return Path(configured) / "model-invocations"
    return WorkerPaths.from_environment().observability_dir / "model-invocations"


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    try:
        ensure_dir(path.parent)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
    except Exception as exc:
        invocation_logger.warning("写入模型调用观测记录失败", error=str(exc))


def _write_full_capture_bundle(
    *,
    record: dict[str, Any],
    prompt_text: str,
    normalized_text: str,
    provider_payload: Any,
    raw_response: Any,
    redact: bool,
) -> None:
    invocation_root = _resolve_model_invocations_dir()
    timestamp = str(record["timestamp"])
    date_segment = timestamp[:10]
    trace_segment = _safe_path_segment(str(record.get("trace_id") or ""), fallback="untraced", max_length=96)
    purpose_segment = _safe_path_segment(str(record.get("purpose") or "unspecified"), fallback="unspecified", max_length=48)
    category = _normalize_capture_category(str(record.get("capture_category") or "other"))
    invocation_id = str(record["invocation_id"])
    time_segment = timestamp[11:].replace(":", "-")
    trace_dir = ensure_dir(invocation_root / "captures" / date_segment / f"trace-{trace_segment}")
    category_dir = ensure_dir(trace_dir / _ARTIFACT_CATEGORY_DIRECTORIES[category])

    with _ARTIFACT_WRITE_LOCK:
        sequence = _next_capture_sequence(trace_dir)
        invocation_dir = ensure_dir(
            category_dir / f"{sequence:03d}_{time_segment}_{purpose_segment}_{invocation_id[:8]}"
        )
        record["prompt_text_ref"] = _write_text_capture(
            invocation_dir,
            "10-prompt.txt",
            prompt_text,
            redact=redact,
        )
        record["response_text_ref"] = _write_text_capture(
            invocation_dir,
            "20-response.txt",
            normalized_text,
            redact=redact,
        )
        record["normalized_text_ref"] = record["response_text_ref"]
        if provider_payload is not None:
            record["provider_payload_ref"] = _write_json_capture(
                invocation_dir,
                "30-provider-request.json",
                provider_payload,
                redact=redact,
            )
        if raw_response is not None:
            record["raw_response_ref"] = _write_json_capture(
                invocation_dir,
                "40-provider-response.json",
                raw_response,
                redact=redact,
            )

        manifest = {
            "schema_version": "2.0.0",
            "sequence": sequence,
            "timestamp": timestamp,
            "trace_id": record.get("trace_id") or "",
            "span_id": record.get("span_id"),
            "invocation_id": invocation_id,
            "purpose": record.get("purpose"),
            "capture_category": category,
            "scene_id": record.get("scene_id"),
            "provider_id": record.get("provider_id"),
            "model_id": record.get("model_id"),
            "outcome": record.get("outcome"),
            "duration_ms": record.get("duration_ms"),
            "prompt_chars": record.get("prompt_chars"),
            "response_chars": record.get("response_chars"),
            "files": {
                "prompt": _relative_name(record.get("prompt_text_ref")),
                "response": _relative_name(record.get("response_text_ref")),
                "provider_request": _relative_name(record.get("provider_payload_ref")),
                "provider_response": _relative_name(record.get("raw_response_ref")),
            },
        }
        _write_json_capture(invocation_dir, "00-manifest.json", manifest, redact=False)
        _rebuild_trace_timeline(trace_dir)


def _next_capture_sequence(trace_dir: Path) -> int:
    highest = 0
    for category_dir in trace_dir.iterdir():
        if not category_dir.is_dir():
            continue
        for entry in category_dir.iterdir():
            if not entry.is_dir():
                continue
            match = _SEQUENCE_PREFIX.match(entry.name)
            if match:
                highest = max(highest, int(match.group(1)))
    return highest + 1


def _rebuild_trace_timeline(trace_dir: Path) -> None:
    manifests: list[tuple[Path, dict[str, Any]]] = []
    for category_dir in sorted(trace_dir.iterdir(), key=lambda item: item.name):
        if not category_dir.is_dir():
            continue
        for entry in category_dir.iterdir():
            if not entry.is_dir() or not _SEQUENCE_PREFIX.match(entry.name):
                continue
            manifest_path = entry / "00-manifest.json"
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            if isinstance(manifest, dict):
                manifests.append((entry, manifest))
    manifests.sort(key=lambda item: int(item[1].get("sequence") or 0))

    trace_id = str(manifests[0][1].get("trace_id") or "") if manifests else ""
    lines = [
        "# 模型调用时间线",
        "",
        f"- Trace ID: `{_markdown_cell(trace_id or 'untraced')}`",
        f"- 调用数: {len(manifests)}",
        "",
        "| 顺序 | 分类 | UTC 时间 | Purpose | Model | Outcome | 耗时 | 输入 | 输出 |",
        "| ---: | --- | --- | --- | --- | --- | ---: | --- | --- |",
    ]
    for entry, manifest in manifests:
        sequence = int(manifest.get("sequence") or 0)
        duration = manifest.get("duration_ms")
        duration_text = f"{duration} ms" if isinstance(duration, (int, float)) else "-"
        files_value = manifest.get("files")
        files: dict[str, Any] = files_value if isinstance(files_value, dict) else {}
        prompt_name = files.get("prompt")
        response_name = files.get("response")
        relative_dir = entry.relative_to(trace_dir).as_posix()
        prompt_link = f"[查看](./{relative_dir}/{prompt_name})" if prompt_name else "-"
        response_link = f"[查看](./{relative_dir}/{response_name})" if response_name else "-"
        lines.append(
            "| "
            + " | ".join([
                f"{sequence:03d}",
                _markdown_cell(str(manifest.get("capture_category") or "other")),
                _markdown_cell(str(manifest.get("timestamp") or "")),
                _markdown_cell(str(manifest.get("purpose") or "")),
                _markdown_cell(str(manifest.get("model_id") or "")),
                _markdown_cell(str(manifest.get("outcome") or "")),
                duration_text,
                prompt_link,
                response_link,
            ])
            + " |"
        )
    (trace_dir / "timeline.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _safe_path_segment(value: str, *, fallback: str, max_length: int) -> str:
    source = value.strip()
    if not source:
        return fallback
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "-", source).strip(".-_")
    if not normalized:
        suffix = hashlib.sha256(source.encode("utf-8")).hexdigest()[:8]
        return f"{fallback}-{suffix}"
    if normalized != source or len(normalized) > max_length:
        suffix = hashlib.sha256(source.encode("utf-8")).hexdigest()[:8]
        normalized = f"{normalized[:max_length - 9]}-{suffix}"
    return normalized[:max_length]


def _normalize_capture_category(value: str) -> str:
    return value if value in _ARTIFACT_CATEGORY_DIRECTORIES else "other"


def _relative_name(reference: Any) -> str | None:
    if not isinstance(reference, str) or not reference:
        return None
    return reference.rsplit("/", 1)[-1]


def _markdown_cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def _write_text_capture(directory: Path, name: str, content: str, *, redact: bool) -> str:
    text = _redact_text(content) if redact else content
    assert text is not None
    target = directory / name
    target.write_text(text, encoding="utf-8")
    return target.relative_to(_resolve_model_invocations_dir()).as_posix()


def _write_json_capture(directory: Path, name: str, payload: Any, *, redact: bool) -> str:
    content = _redact_json(payload) if redact else payload
    target = directory / name
    target.write_text(json.dumps(content, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return target.relative_to(_resolve_model_invocations_dir()).as_posix()


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest() if text else ""


def _redact_json(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            if any(secret in key.lower() for secret in _SECRET_KEYWORDS):
                redacted[key] = "[REDACTED]"
                continue
            redacted[key] = _redact_json(item)
        return redacted
    if isinstance(value, list):
        return [_redact_json(item) for item in value]
    if isinstance(value, str):
        return _redact_text(value)
    return value


def _redact_text(text: str | None) -> str | None:
    if text is None:
        return None
    redacted = text
    for pattern, replacement in _SECRET_PATTERNS:
        redacted = pattern.sub(replacement, redacted)
    return redacted


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


transport_logger = get_logger("kernel_cognition_grpc")

_ERROR_KEY = "glimmer-error-bin"
_COGNITION_SERVICE = "glimmer.cognition.v1.CognitionService"
_KERNEL_SERVICE = "glimmer.kernel.v1.KernelControlService"


def _perception_state(state: str) -> int:
    return {
        "accepted": cognition_pb.PERCEPTION_OPERATION_STATE_ACCEPTED,
        "running": cognition_pb.PERCEPTION_OPERATION_STATE_RUNNING,
        "succeeded": cognition_pb.PERCEPTION_OPERATION_STATE_SUCCEEDED,
        "cancelled": cognition_pb.PERCEPTION_OPERATION_STATE_CANCELLED,
        "failed": cognition_pb.PERCEPTION_OPERATION_STATE_FAILED,
    }.get(state, cognition_pb.PERCEPTION_OPERATION_STATE_UNSPECIFIED)


def _parse_struct(value: dict[str, Any] | None, target: Any) -> None:
    ParseDict(value or {}, target)


class ServiceFault(Exception):
    def __init__(self, code: int, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class KernelServiceError(Exception):
    """Kernel 返回的受控 typed failure；不暴露远端内部异常文本。"""

    def __init__(
        self,
        code: int,
        safe_message: str,
        *,
        retryable: bool = False,
        call: Any = None,
        recovery_actions: tuple[int, ...] = (),
        operation_id: str = "",
    ) -> None:
        super().__init__(safe_message)
        self.code = code
        self.safe_message = safe_message
        self.retryable = retryable
        self.call = call
        self.recovery_actions = recovery_actions
        self.operation_id = operation_id


def _grpc_status(code: int) -> grpc.StatusCode:
    return {
        common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST: grpc.StatusCode.INVALID_ARGUMENT,
        common_pb.SERVICE_ERROR_CODE_NOT_READY: grpc.StatusCode.FAILED_PRECONDITION,
        common_pb.SERVICE_ERROR_CODE_GENERATION_MISMATCH: grpc.StatusCode.PERMISSION_DENIED,
        common_pb.SERVICE_ERROR_CODE_CANCELLED: grpc.StatusCode.CANCELLED,
        common_pb.SERVICE_ERROR_CODE_DEADLINE_EXCEEDED: grpc.StatusCode.DEADLINE_EXCEEDED,
        common_pb.SERVICE_ERROR_CODE_UNAVAILABLE: grpc.StatusCode.UNAVAILABLE,
        common_pb.SERVICE_ERROR_CODE_RECOVERY_REQUIRED: grpc.StatusCode.FAILED_PRECONDITION,
    }.get(code, grpc.StatusCode.INTERNAL)


class CognitionGrpcHost:
    """由 CognitionHost 监督的动态回环 gRPC Service host。"""

    def __init__(
        self,
        *,
        generation: str,
        inbound: KernelRequestPort,
        queue: ObservationQueue,
        activity: CognitiveActivityController,
        cycle: LoopController,
        shutdown: Callable[[], Awaitable[None]],
        operations: PerceptionOperationRegistry,
        workspace: AttentionController,
        readiness: ReadinessTracker | None = None,
        consolidation: ConsolidationCoordinator | None = None,
        planning: PlanningStore | None = None,
        conversation: ConversationRecorder | None = None,
    ) -> None:
        self.generation = generation
        self._inbound = inbound
        self._queue = queue
        self._activity = activity
        self._cycle = cycle
        self._shutdown = shutdown
        self._operations = operations
        self._workspace = workspace
        self._consolidation = consolidation
        self._planning = planning
        self._conversation = conversation
        self._server: grpc.aio.Server | None = None
        self._endpoint: str | None = None
        self._readiness_tracker = readiness or ReadinessTracker(frozenset({"domain"}))
        self._inflight: dict[int, asyncio.Task[Any]] = {}
        self._completed: OrderedDict[str, None] = OrderedDict()

    @property
    def endpoint(self) -> str:
        if self._endpoint is None:
            raise RuntimeError("Cognition gRPC host 尚未绑定")
        return self._endpoint

    async def start(self) -> None:
        if self._server is not None:
            return
        server = grpc.aio.server()
        handlers = {
            "SubmitPerception": self._method(self._submit_perception, cognition_pb.SubmitPerceptionRequest, cognition_pb.SubmitPerceptionResponse),
            "CancelPerception": self._method(self._cancel_perception, cognition_pb.CancelPerceptionRequest, cognition_pb.CancelPerceptionResponse),
            "GetPerceptionOperation": self._method(self._get_perception_operation, cognition_pb.GetPerceptionOperationRequest, cognition_pb.GetPerceptionOperationResponse),
            "InitializeKnowledge": self._method(self._initialize_knowledge, cognition_pb.InitializeKnowledgeRequest, cognition_pb.InitializeKnowledgeResponse),
            "Plan": self._method(self._plan, cognition_pb.PlanRequest, cognition_pb.PlanResponse),
            "Synthesize": self._method(self._synthesize, cognition_pb.SynthesizeRequest, cognition_pb.SynthesizeResponse),
            "GetConversationHistory": self._method(self._history, cognition_pb.GetConversationHistoryRequest, cognition_pb.GetConversationHistoryResponse),
            "Heartbeat": self._method(self._heartbeat, cognition_pb.HeartbeatRequest, cognition_pb.HeartbeatResponse),
            "GetReadiness": self._method(self._readiness, cognition_pb.GetReadinessRequest, cognition_pb.GetReadinessResponse),
            "Shutdown": self._method(self._shutdown_rpc, cognition_pb.ShutdownRequest, cognition_pb.ShutdownResponse),
            "ExecuteMemoryJob": self._method(self._execute_memory_job, cognition_pb.ExecuteMemoryJobRequest, cognition_pb.ExecuteMemoryJobResponse),
            "ReconcileMemoryJob": self._method(self._reconcile_memory_job, cognition_pb.ReconcileMemoryJobRequest, cognition_pb.ReconcileMemoryJobResponse),
            "ReadMemoryJobRequests": self._method(self._read_memory_job_requests, cognition_pb.ReadMemoryJobRequestsRequest, cognition_pb.ReadMemoryJobRequestsResponse),
            "AcknowledgeMemoryJobRequest": self._method(self._acknowledge_memory_job_request, cognition_pb.AcknowledgeMemoryJobRequestRequest, cognition_pb.AcknowledgeMemoryJobRequestResponse),
            "PublishMemoryJobState": self._method(self._publish_memory_job_state, cognition_pb.PublishMemoryJobStateRequest, cognition_pb.PublishMemoryJobStateResponse),
            "ReadPlanningJobRequests": self._method(self._read_planning_job_requests, cognition_pb.ReadPlanningJobRequestsRequest, cognition_pb.ReadPlanningJobRequestsResponse),
            "AcknowledgePlanningJobRequest": self._method(self._acknowledge_planning_job_request, cognition_pb.AcknowledgePlanningJobRequestRequest, cognition_pb.AcknowledgePlanningJobRequestResponse),
        }
        server.add_generic_rpc_handlers((grpc.method_handlers_generic_handler(_COGNITION_SERVICE, handlers),))
        server.add_generic_rpc_handlers((grpc.method_handlers_generic_handler(
            "glimmer.conversation.v1.ConversationService", {
                "AcceptExecutionResult": self._method(self._accept_execution_result,
                    conversation_pb.AcceptExecutionResultRequest, conversation_pb.AcceptExecutionResultResponse),
            }),))
        port = server.add_insecure_port("127.0.0.1:0")
        if port <= 0:
            raise RuntimeError("Cognition gRPC 动态回环端点绑定失败")
        await server.start()
        self._server = server
        self._endpoint = f"grpc://127.0.0.1:{port}"
        self._readiness_tracker.phase = "domain_starting"
        transport_logger.info("Cognition gRPC Service 已绑定动态回环端点")

    def mark_ready(self) -> None:
        self._readiness_tracker.mark_ready("domain")

    async def stop(self) -> None:
        self._readiness_tracker.begin_shutdown()
        inflight = tuple(self._inflight.values())
        for task in inflight:
            if not task.done():
                task.cancel()
        if inflight:
            await asyncio.gather(*inflight, return_exceptions=True)
        self._inflight.clear()
        if self._server is not None:
            await self._server.stop(grace=1.0)
            await self._server.wait_for_termination(timeout=2.0)
            self._server = None
        self._endpoint = None
        self._readiness_tracker.mark_stopped()

    @staticmethod
    def _method(handler: Callable[..., Awaitable[Any]], request_type: Any, response_type: Any) -> Any:
        return grpc.unary_unary_rpc_method_handler(
            handler,
            request_deserializer=request_type.FromString,
            response_serializer=response_type.SerializeToString,
        )

    def _assert_call(self, call: common_pb.CallMetadata | None) -> str:
        if call is None or not call.trace_id:
            raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "缺少调用 trace metadata")
        if call.generation != self.generation:
            raise ServiceFault(common_pb.SERVICE_ERROR_CODE_GENERATION_MISMATCH, "Kernel 调用世代已失效")
        return call.trace_id

    async def _invoke(self, request: Any, context: grpc.aio.ServicerContext, operation: Callable[[str], Awaitable[Any]], *, track: bool = False, require_ready: bool = False, allow_stopping: bool = False) -> Any:
        try:
            trace_id = self._assert_call(request.call)
            if not allow_stopping and self._readiness_tracker.phase in {"stopping", "stopped"}:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_NOT_READY, "Worker 已停止接纳请求")
            if require_ready and not self._readiness_tracker.is_ready:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_NOT_READY, "Worker 尚未业务就绪", retryable=True)
            with TraceContext(trace_id):
                task = asyncio.current_task()
                if track and task is not None:
                    # 同一 Job 的重试/对账可沿用 trace；trace 不能充当资源所有权 key。
                    self._inflight[id(task)] = task
                try:
                    return await operation(trace_id)
                finally:
                    if track:
                        self._inflight.pop(id(task), None)
        except asyncio.CancelledError:
            await self._abort(context, common_pb.SERVICE_ERROR_CODE_CANCELLED, "请求已取消", getattr(request, "call", None))
            raise
        except ServiceFault as fault:
            await self._abort(context, fault.code, str(fault), getattr(request, "call", None), fault.retryable)
        except Exception:
            transport_logger.exception("Cognition gRPC 调用失败")
            await self._abort(context, common_pb.SERVICE_ERROR_CODE_INTERNAL, "Cognition 处理请求失败", getattr(request, "call", None))
        raise RuntimeError("gRPC abort 未终止调用")

    @staticmethod
    async def _abort(context: grpc.aio.ServicerContext, code: int, message: str, call: Any, retryable: bool = False) -> None:
        detail = common_pb.ServiceErrorDetail(code=code, safe_message=message, retryable=retryable)
        if code == common_pb.SERVICE_ERROR_CODE_RECOVERY_REQUIRED:
            detail.recovery_actions.append(common_pb.SERVICE_RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE)
        if call is not None:
            detail.call.CopyFrom(call)
        context.set_trailing_metadata(((_ERROR_KEY, detail.SerializeToString()),))
        await context.abort(_grpc_status(code), message)

    def _is_completed(self, call: common_pb.CallMetadata) -> bool:
        key = call.idempotency_key
        return bool(key and key in self._completed)

    def _mark_completed(self, call: common_pb.CallMetadata) -> None:
        key = call.idempotency_key
        if not key:
            return
        self._completed[key] = None
        if len(self._completed) > 2048:
            self._completed.popitem(last=False)

    async def _accept_execution_result(self, request: Any, context: Any) -> Any:
        async def operation(_trace_id: str) -> Any:
            if self._conversation is None or not self._conversation.accepts_execution_results:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_NOT_READY, "Conversation 结果接收 owner 未 ready", retryable=True)
            try:
                if not request.HasField("event"):
                    raise ValueError("缺少 Execution 结果")
                fact = execution_result_from_wire(request.event)
                moment = await self._conversation.accept_execution_result(fact)
            except (ValueError, TypeError) as error:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "Execution 结果无效") from error
            except RuntimeError as error:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_RECOVERY_REQUIRED, "Execution 交互引用或接纳 identity 冲突") from error
            if not 1 <= moment.seq <= 9007199254740991:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_RECOVERY_REQUIRED, "Conversation Log position 不可表示")
            return conversation_pb.AcceptExecutionResultResponse(event_id=fact.event_id,
                invocation_id=fact.invocation_id, revision=fact.revision,
                moment_id=moment.moment_id, log_position=moment.seq, accepted=True)
        return await self._invoke(request, context, operation, track=True, require_ready=True)

    async def _submit_perception(self, request: Any, context: Any) -> Any:
        async def operation(trace_id: str) -> Any:
            operation_id = request.call.idempotency_key or trace_id
            try:
                # 接纳前完成校验，防止非法重试得到 accepted 确认。
                observation = observation_from_wire(request, trace_id=trace_id)
                perception_operation, duplicate = self._operations.accept(operation_id, trace_id)
            except (ValueError, PerceptionOperationConflict) as error:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, str(error)) from error
            if not duplicate:
                dropped = self._queue.put(observation)
                if dropped is not None:
                    self._operations.finish(dropped.trace_id, "failed", "感知队列容量已满")
                if observation.address_mode == "direct":
                    self._activity.engage("direct_perception")
                else:
                    self._activity.observe_activity("ambient_perception")
                self._cycle.notify_external_input()
            return cognition_pb.SubmitPerceptionResponse(
                operation_id=perception_operation.operation_id,
                state=_perception_state(perception_operation.state),
                duplicate=duplicate,
            )
        return await self._invoke(request, context, operation, require_ready=True)

    async def _cancel_perception(self, request: Any, context: Any) -> Any:
        async def operation(_trace_id: str) -> Any:
            self._queue.remove(request.target_trace_id)
            await self._workspace.remove_perception(request.target_trace_id)
            perception_operation = await self._operations.cancel(request.target_trace_id)
            if perception_operation is None:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "感知操作不存在")
            return cognition_pb.CancelPerceptionResponse(
                operation_id=perception_operation.operation_id,
                target_trace_id=request.target_trace_id,
                state=_perception_state(perception_operation.state),
                terminal=perception_operation.terminal,
            )
        return await self._invoke(request, context, operation, allow_stopping=True)

    async def _get_perception_operation(self, request: Any, context: Any) -> Any:
        async def operation(_trace_id: str) -> Any:
            perception_operation = self._operations.get(request.operation_id)
            if perception_operation is None:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "感知操作不存在")
            return cognition_pb.GetPerceptionOperationResponse(
                operation_id=perception_operation.operation_id,
                state=_perception_state(perception_operation.state),
                terminal=perception_operation.terminal,
                safe_message=perception_operation.safe_message,
            )
        return await self._invoke(request, context, operation, allow_stopping=True)

    async def _initialize_knowledge(self, request: Any, context: Any) -> Any:
        async def operation(trace_id: str) -> Any:
            duplicate = self._is_completed(request.call)
            if not duplicate:
                await self._inbound.on_knowledge_init(knowledge_initialization_from_wire(request))
                self._mark_completed(request.call)
            return cognition_pb.InitializeKnowledgeResponse(operation_id=request.call.idempotency_key or trace_id, status="duplicate" if duplicate else "initialized", duplicate=duplicate)
        return await self._invoke(request, context, operation, track=True)

    async def _plan(self, request: Any, context: Any) -> Any:
        async def operation(trace_id: str) -> Any:
            try:
                plan_input = agent_plan_from_wire(request, trace_id=trace_id)
            except (ValueError, TypeError) as error:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "规划方法引用/材料或预算无效") from error
            output = await self._inbound.on_agent_plan(plan_input)
            return agent_plan_to_wire(output)
        return await self._invoke(request, context, operation, track=True, require_ready=True)

    async def _synthesize(self, request: Any, context: Any) -> Any:
        async def operation(trace_id: str) -> Any:
            try:
                output = await self._inbound.on_agent_synthesis(agent_synthesis_from_wire(request, trace_id=trace_id))
            except RuntimeError as error:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_NOT_READY, "合成等待已接纳的 Execution 交互结果", retryable=True) from error
            return agent_synthesis_to_wire(output)
        return await self._invoke(request, context, operation, track=True, require_ready=True)

    async def _history(self, request: Any, context: Any) -> Any:
        async def operation(_trace_id: str) -> Any:
            output = await self._inbound.on_conversation_history(history_query_from_wire(request))
            return history_result_to_wire(output)
        return await self._invoke(request, context, operation, track=True, require_ready=True)

    async def _heartbeat(self, request: Any, context: Any) -> Any:
        return await self._invoke(request, context, lambda _trace_id: _return(cognition_pb.HeartbeatResponse(status="alive", generation=self.generation)), allow_stopping=True)

    async def _readiness(self, request: Any, context: Any) -> Any:
        return await self._invoke(request, context, lambda _trace_id: _return(cognition_pb.GetReadinessResponse(state=self._readiness_tracker.state, phase=self._readiness_tracker.phase, generation=self.generation)), allow_stopping=True)

    @staticmethod
    def _memory_job_identity(request: Any) -> MemoryJobIdentity:
        if not request.HasField("identity"):
            raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "缺少原 Job attempt identity")
        identity = request.identity
        return MemoryJobIdentity(identity.job_id, identity.scope_id, identity.attempt, identity.authority_epoch,
                                 identity.fencing_token, identity.owner_id, identity.lease_until_ms)

    @staticmethod
    def _memory_job_result(identity: Any, receipt: MemoryConsolidationReceipt | None, fenced: bool, observed_at: int) -> Any:
        resolution = "applied" if receipt is not None else "not_applied"
        document = [identity.job_id, identity.scope_id, identity.attempt, identity.authority_epoch,
                    identity.fencing_token, identity.owner_id, resolution, receipt.receipt_id if receipt else "sealed"]
        evidence_id = hashlib.sha256(json.dumps(document, separators=(",", ":")).encode("utf-8")).hexdigest()
        result = cognition_pb.MemoryJobResult(
            resolution=cognition_pb.MEMORY_JOB_RESOLUTION_APPLIED if receipt else cognition_pb.MEMORY_JOB_RESOLUTION_NOT_APPLIED,
            source_id="cognition.memory", receiver_fenced=fenced, evidence_id=evidence_id,
            observed_at_ms=observed_at,
        )
        result.identity.CopyFrom(identity)
        if receipt is not None:
            result.receipt_id = receipt.receipt_id
            result.operation_id = receipt.operation_id
            result.memory_ids.extend(receipt.memory_ids)
            result.committed_at = receipt.committed_at
            result.duplicate = receipt.duplicate
        return result

    async def _execute_memory_job(self, request: Any, context: Any) -> Any:
        async def operation(_trace_id: str) -> Any:
            coordinator = self._external_memory_jobs()
            identity = self._memory_job_identity(request)
            item = MemoryConsolidationInput(request.episode_id, request.episode_version, identity.scope_id, request.input_digest)
            try:
                receipt = await coordinator.execute_job(identity, item)
                proof = await coordinator.reconcile_job(identity)
            except MemoryConsolidationConflictError as error:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_RECOVERY_REQUIRED, "Memory Job 身份/输入/提交资格冲突；须对账原 attempt") from error
            return cognition_pb.ExecuteMemoryJobResponse(result=self._memory_job_result(request.identity, receipt, proof.receiver_fenced, proof.observed_at))
        return await self._invoke(request, context, operation, track=True, require_ready=True)

    async def _reconcile_memory_job(self, request: Any, context: Any) -> Any:
        async def operation(_trace_id: str) -> Any:
            coordinator = self._external_memory_jobs()
            identity = self._memory_job_identity(request)
            try:
                result: MemoryJobResult = await coordinator.reconcile_job(identity)
            except MemoryConsolidationConflictError as error:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_RECOVERY_REQUIRED, "Memory Job 原 attempt 对账冲突") from error
            return cognition_pb.ReconcileMemoryJobResponse(result=self._memory_job_result(request.identity, result.receipt, result.receiver_fenced, result.observed_at))
        return await self._invoke(request, context, operation, track=True, allow_stopping=True)

    def _external_memory_jobs(self) -> ConsolidationCoordinator:
        if self._consolidation is None or not self._consolidation.uses_external_jobs:
            raise ServiceFault(common_pb.SERVICE_ERROR_CODE_NOT_READY, "Memory 源投递尚未切换外部 Jobs owner")
        return self._consolidation

    async def _read_memory_job_requests(self, request: Any, context: Any) -> Any:
        async def operation(_trace_id: str) -> Any:
            coordinator = self._external_memory_jobs()
            if not 1 <= request.limit <= 1000:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "Memory 源请求扫描上限无效")
            requests = await coordinator.source_job_requests(limit=request.limit)
            return cognition_pb.ReadMemoryJobRequestsResponse(requests=[cognition_pb.MemoryJobSourceRequest(
                request_id=item.request_id, episode_id=item.input.episode_id, episode_version=item.input.episode_version,
                scope_id=item.input.scope_id, input_digest=item.input.input_digest, created_at=item.created_at,
            ) for item in requests])
        return await self._invoke(request, context, operation, track=True, require_ready=True)

    async def _acknowledge_memory_job_request(self, request: Any, context: Any) -> Any:
        async def operation(_trace_id: str) -> Any:
            coordinator = self._external_memory_jobs()
            if not request.HasField("request"):
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "缺少 Memory 源请求 identity")
            item = request.request
            if not 1 <= item.episode_version <= 9007199254740991:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "Memory 源请求版本无效")
            source = MemoryConsolidationRequest(item.request_id, MemoryConsolidationInput(item.episode_id,
                item.episode_version, item.scope_id, item.input_digest), item.created_at)
            try:
                coordinator.acknowledge_job_request(source, request.job_id)
            except MemoryConsolidationConflictError as error:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_RECOVERY_REQUIRED, "Memory 源请求接纳冲突") from error
            return cognition_pb.AcknowledgeMemoryJobRequestResponse(request_id=item.request_id,
                job_id=request.job_id, accepted=True)
        return await self._invoke(request, context, operation, track=True, require_ready=True)

    async def _publish_memory_job_state(self, request: Any, context: Any) -> Any:
        async def operation(_trace_id: str) -> Any:
            coordinator = self._external_memory_jobs()
            if not request.HasField("event") or request.event.ByteSize() > 65536:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "Memory 状态事实缺失或超出上限")
            event = request.event
            statuses = {jobs_pb.JOB_STATUS_QUEUED: "queued", jobs_pb.JOB_STATUS_RUNNING: "running",
                jobs_pb.JOB_STATUS_RETRY_WAIT: "retry_wait", jobs_pb.JOB_STATUS_SUCCEEDED: "succeeded",
                jobs_pb.JOB_STATUS_CANCELLED: "cancelled", jobs_pb.JOB_STATUS_DEAD_LETTER: "dead_letter",
                jobs_pb.JOB_STATUS_UNKNOWN: "unknown"}
            identity = json.dumps([event.job_id, event.revision], separators=(",", ":"), ensure_ascii=False)
            if event.status not in statuses or event.kind != "memory.consolidate" or not event.scope_id.strip() \
                or event.job_id != f"memory:{event.goal_id}" or not re.fullmatch(r"[a-f0-9]{64}", event.goal_id) \
                or event.event_id != hashlib.sha256(identity.encode("utf-8")).hexdigest() \
                or not all(1 <= value <= 9007199254740991 for value in
                    (event.revision, event.authority_epoch, request.delivery_authority_epoch)) \
                or not all(0 <= value <= 9007199254740991 for value in
                    (event.attempt, event.fencing_token, event.updated_at_ms)):
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "Memory 状态事实 identity/枚举/整数无效")
            if event.status in {jobs_pb.JOB_STATUS_RUNNING, jobs_pb.JOB_STATUS_RETRY_WAIT,
                    jobs_pb.JOB_STATUS_SUCCEEDED, jobs_pb.JOB_STATUS_UNKNOWN} and (not event.attempt or not event.fencing_token):
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "Memory 执行状态缺少 attempt/token")
            feedback = MemoryJobFeedback(event.goal_id, event.job_id, event.scope_id, event.event_id,
                hashlib.sha256(event.SerializeToString(deterministic=True)).hexdigest(), event.revision,
                statuses[event.status], event.authority_epoch, request.delivery_authority_epoch, event.updated_at_ms)
            try:
                duplicate = await coordinator.accept_job_feedback(feedback,
                    MessageToDict(event.result) if event.HasField("result") else None)
            except MemoryConsolidationConflictError as error:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_RECOVERY_REQUIRED, "Memory 状态源/receipt/投递身份冲突") from error
            return cognition_pb.PublishMemoryJobStateResponse(event_id=event.event_id, accepted=True, duplicate=duplicate)
        return await self._invoke(request, context, operation, track=True, require_ready=True)

    def _planning_jobs_source(self) -> PlanningStore:
        if self._planning is None:
            raise ServiceFault(common_pb.SERVICE_ERROR_CODE_NOT_READY, "Planning 源持久 owner 未装配")
        return self._planning

    async def _read_planning_job_requests(self, request: Any, context: Any) -> Any:
        async def operation(_trace_id: str) -> Any:
            source = self._planning_jobs_source()
            if not 1 <= request.limit <= 1000:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "Planning 源扫描上限无效")
            try:
                requests = await source.pending_job_requests(limit=request.limit)
                return cognition_pb.ReadPlanningJobRequestsResponse(requests=[planning_source_to_wire(item) for item in requests])
            except ValueError as error:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_RECOVERY_REQUIRED, "Planning 持久源无效；须受控恢复") from error
        return await self._invoke(request, context, operation, track=True, require_ready=True)

    async def _acknowledge_planning_job_request(self, request: Any, context: Any) -> Any:
        async def operation(_trace_id: str) -> Any:
            source = self._planning_jobs_source()
            if not request.HasField("request") or not 1 <= request.job_revision <= 9007199254740991:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "Planning 源 ACK 缺少请求或有效 revision")
            try:
                item = planning_source_from_wire(request.request)
                if request.job_id != f"planning:{item.request_id}":
                    raise ValueError("Planning Job identity 不匹配")
            except ValueError as error:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "Planning 源 ACK identity/版本/due 无效") from error
            try:
                await source.acknowledge_job_request(item, JobReceipt(request.job_id,
                    "duplicate" if request.duplicate else "accepted", request.job_revision))
            except PlanningConflictError as error:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_RECOVERY_REQUIRED, "Planning 源接纳内容或 Job 绑定冲突") from error
            return cognition_pb.AcknowledgePlanningJobRequestResponse(request_id=item.request_id, job_id=request.job_id, accepted=True)
        return await self._invoke(request, context, operation, track=True, require_ready=True)

    async def _shutdown_rpc(self, request: Any, context: Any) -> Any:
        async def operation(trace_id: str) -> Any:
            duplicate = self._is_completed(request.call)
            if not duplicate:
                self._readiness_tracker.begin_shutdown()
                asyncio.ensure_future(self._shutdown())
                self._mark_completed(request.call)
            return cognition_pb.ShutdownResponse(operation_id=request.call.idempotency_key or trace_id, status="duplicate" if duplicate else "accepted", duplicate=duplicate)
        return await self._invoke(request, context, operation, allow_stopping=True)


async def _return(value: Any) -> Any:
    return value


class KernelGrpcClient:
    """Cognition 进程独占的 KernelControlService client。"""

    def __init__(self, generation: str, registration_nonce: str, registration_secret: bytearray | str) -> None:
        self.generation = generation
        self._registration_nonce = registration_nonce
        self._registration_secret = registration_secret if isinstance(registration_secret, bytearray) else bytearray(
            base64.urlsafe_b64decode(registration_secret + "=" * (-len(registration_secret) % 4))
        )
        self._channel: grpc.aio.Channel | None = None

    async def start(self, kernel_endpoint: str, cognition_endpoint: str) -> None:
        if not kernel_endpoint.startswith("grpc://127.0.0.1:"):
            raise ValueError("Kernel gRPC endpoint 必须是动态回环地址")
        self._channel = grpc.aio.insecure_channel(kernel_endpoint.removeprefix("grpc://"))
        proof_payload = f"{self.generation}\n{self._registration_nonce}\n{cognition_endpoint}\n{os.getpid()}\n{os.getppid()}".encode()
        auth_proof = hmac.new(bytes(self._registration_secret), proof_payload, hashlib.sha256).digest()
        try:
            response = await self._call(
                "RegisterCognition",
                kernel_pb.RegisterCognitionRequest(
                    call=self._call_metadata(),
                    endpoint=cognition_endpoint,
                    process_id=os.getpid(),
                    supervisor_process_id=os.getppid(),
                    registration_nonce=self._registration_nonce,
                    auth_proof=auth_proof,
                ),
                kernel_pb.RegisterCognitionRequest,
                kernel_pb.RegisterCognitionResponse,
            )
        finally:
            self._registration_secret[:] = b"\0" * len(self._registration_secret)
            self._registration_nonce = ""
        if not response.accepted or response.generation != self.generation:
            raise RuntimeError("Kernel 拒绝 Cognition gRPC Service 注册")

    async def stop(self) -> None:
        if self._channel is not None:
            await self._channel.close(grace=1.0)
            self._channel = None

    def _call_metadata(self, trace_id: str | None = None, idempotency_key: str = "") -> common_pb.CallMetadata:
        resolved = trace_id or new_trace_id()
        return common_pb.CallMetadata(trace_id=resolved, correlation_id=resolved, generation=self.generation, idempotency_key=idempotency_key)

    async def send_state_sync(self, state: dict[str, Any]) -> None:
        """Implement KernelEventPort without a stateless forwarding adapter."""
        await self.publish_state(state)

    async def send_log(
        self, level: str, message: str, extra: dict[str, Any] | None = None
    ) -> None:
        await self.publish_log(level, message, extra or {})

    async def send_action_command(self, command: dict[str, Any]) -> None:
        transport_logger.debug(
            "发送 ActionCommand 给 Kernel",
            action_type=command.get("action_type"),
        )
        await self.publish_action(command)

    async def publish_state(self, state: dict[str, Any]) -> None:
        request = kernel_pb.PublishStateRequest(call=self._call_metadata())
        _parse_struct(state, request.state)
        await self._call("PublishState", request, kernel_pb.PublishStateRequest, kernel_pb.PublishStateResponse)

    async def publish_log(self, level: str, message: str, attributes: dict[str, Any]) -> None:
        request = kernel_pb.PublishLogRequest(call=self._call_metadata(), level=level, message=message)
        _parse_struct(attributes, request.attributes)
        await self._call("PublishLog", request, kernel_pb.PublishLogRequest, kernel_pb.PublishLogResponse)

    async def publish_action(self, command: dict[str, Any]) -> None:
        trace_id = str(command.get("trace_id") or new_trace_id())
        target = command.get("target") or {}
        payload = command.get("payload") or {}
        request = kernel_pb.PublishActionRequest(
            call=self._call_metadata(trace_id, f"action:{trace_id}"),
            action_type=str(command.get("action_type") or ""),
            target_scene_id=str(target.get("scene_id") or ""),
            channel_hint=str(target.get("channel_hint") or ""),
            text=str(payload.get("text") or ""),
        )
        request.call.causation_id = str(command.get("source_fact_id") or "")
        for message in payload.get("messages") or []:
            request.messages.add(sequence=int(message.get("sequence") or 0), content_type=str(message.get("content_type") or "text"), text=str(message.get("text") or ""), language=str(message.get("language") or ""))
        for item in payload.get("items") or []:
            request.items.add(type=str(item.get("type") or ""), uri=str(item.get("uri") or ""), mime_type=str(item.get("mime_type") or ""))
        skill = payload.get("skill_request")
        if isinstance(skill, dict):
            request.skill_request.original_goal = str(skill.get("original_goal") or "")
            request.skill_request.capability_kind = str(skill.get("capability_kind") or "")
            request.skill_request.confidence = float(skill.get("confidence") or 0.0)
            request.skill_request.reason = str(skill.get("reason") or "")
            request.skill_request.planning_hint = str(skill.get("planning_hint") or "")
            conversation = skill.get("conversation") or {}
            for field in ("source_provider_id", "scene_id", "conversation_id", "continuity_id", "thread_id", "interaction_id", "recall_scope", "disclosure_scope"):
                setattr(request.skill_request.conversation, field, str(conversation.get(field) or ""))
        _parse_struct(command.get("emotion_state") or {}, request.emotion_state)
        response = await self._call(
            "PublishAction",
            request,
            kernel_pb.PublishActionRequest,
            kernel_pb.PublishActionResponse,
            timeout=None,
        )
        if response.status not in {"completed", "duplicate"}:
            raise KernelServiceError(common_pb.SERVICE_ERROR_CODE_INTERNAL, "Kernel action 未到达终态")

    async def expose_step(self, request: capabilities_pb.ExposeStepRequest, trace_id: str) -> capabilities_pb.ExposeStepResponse:
        request.call.CopyFrom(self._call_metadata(trace_id))
        return await self._call("ExposeStep", request, capabilities_pb.ExposeStepRequest, capabilities_pb.ExposeStepResponse,
            service="glimmer.capabilities.v1.CapabilityService")

    async def invoke_tool(self, request: capabilities_pb.InvokeToolRequest, trace_id: str) -> capabilities_pb.InvokeToolResponse:
        request.call.CopyFrom(self._call_metadata(trace_id, request.call.idempotency_key))
        return await self._call("InvokeTool", request, capabilities_pb.InvokeToolRequest, capabilities_pb.InvokeToolResponse,
            service="glimmer.capabilities.v1.CapabilityService", timeout=None)

    async def read_skill(self, request: capabilities_pb.ReadCapabilityRequest, trace_id: str) -> capabilities_pb.ReadCapabilityResponse:
        return await self._read_capability("ReadSkill", request, trace_id)

    async def read_resource(self, request: capabilities_pb.ReadCapabilityRequest, trace_id: str) -> capabilities_pb.ReadCapabilityResponse:
        return await self._read_capability("ReadResource", request, trace_id)

    async def collect_knowledge_resource(self, request: capabilities_pb.CollectKnowledgeResourceRequest, trace_id: str) -> capabilities_pb.CollectKnowledgeResourceResponse:
        request.call.CopyFrom(self._call_metadata(trace_id))
        return await self._call("CollectKnowledgeResource", request, capabilities_pb.CollectKnowledgeResourceRequest,
            capabilities_pb.CollectKnowledgeResourceResponse, service="glimmer.capabilities.v1.CapabilityService")

    async def validate_knowledge_resource(self, request: capabilities_pb.ValidateKnowledgeResourceRequest, trace_id: str) -> capabilities_pb.ValidateKnowledgeResourceResponse:
        request.call.CopyFrom(self._call_metadata(trace_id))
        return await self._call("ValidateKnowledgeResource", request, capabilities_pb.ValidateKnowledgeResourceRequest,
            capabilities_pb.ValidateKnowledgeResourceResponse, service="glimmer.capabilities.v1.CapabilityService")

    async def _read_capability(self, method: str, request: capabilities_pb.ReadCapabilityRequest, trace_id: str) -> capabilities_pb.ReadCapabilityResponse:
        request.call.CopyFrom(self._call_metadata(trace_id, request.call.idempotency_key))
        request_type, response_type = (capabilities_pb.ReadSkillRequest, capabilities_pb.ReadSkillResponse) if method == "ReadSkill" else (capabilities_pb.ReadResourceRequest, capabilities_pb.ReadResourceResponse)
        response = await self._call(method, request_type(request=request), request_type, response_type,
            service="glimmer.capabilities.v1.CapabilityService", timeout=None)
        if not response.HasField("result"):
            raise KernelServiceError(common_pb.SERVICE_ERROR_CODE_INTERNAL, "Native read 缺少结果投影")
        return response.result

    async def _call(self, method: str, request: Any, request_type: Any, response_type: Any, *, timeout: float | None = 5.0,
                    service: str = _KERNEL_SERVICE) -> Any:
        if self._channel is None:
            raise RuntimeError("Kernel gRPC client 尚未启动")
        call = self._channel.unary_unary(
            f"/{service}/{method}",
            request_serializer=request_type.SerializeToString,
            response_deserializer=response_type.FromString,
        )
        try:
            return await call(request, timeout=timeout)
        except grpc.aio.AioRpcError as error:
            for key, value in error.trailing_metadata() or ():
                if key == _ERROR_KEY and isinstance(value, bytes):
                    detail = common_pb.ServiceErrorDetail()
                    try:
                        detail.ParseFromString(value)
                    except Exception:
                        break
                    raise KernelServiceError(
                        detail.code,
                        detail.safe_message or "Kernel 请求失败",
                        retryable=detail.retryable,
                        call=detail.call if detail.HasField("call") else None,
                        recovery_actions=tuple(detail.recovery_actions),
                        operation_id=detail.operation_id,
                    ) from None
            code = {
                grpc.StatusCode.CANCELLED: common_pb.SERVICE_ERROR_CODE_CANCELLED,
                grpc.StatusCode.DEADLINE_EXCEEDED: common_pb.SERVICE_ERROR_CODE_DEADLINE_EXCEEDED,
                grpc.StatusCode.UNAVAILABLE: common_pb.SERVICE_ERROR_CODE_UNAVAILABLE,
            }.get(error.code(), common_pb.SERVICE_ERROR_CODE_INTERNAL)
            raise KernelServiceError(
                code,
                "Kernel 请求已取消" if code == common_pb.SERVICE_ERROR_CODE_CANCELLED else "Kernel Service 暂不可用",
                retryable=code == common_pb.SERVICE_ERROR_CODE_UNAVAILABLE,
            ) from None



# 初始化模块日志器
logger = get_logger("cognition_host")

STATE_SYNC_FALLBACK_INTERVAL_S = 30.0
STATE_SYNC_LOOP_INTERVAL_S = 5.0


# ======================================
# Cognition 认知核主类
# ======================================
class CognitionHost:
    """
    Cognition 认知核主类，管理整个认知层的完整生命周期。
    核心作用：作为认知层根节点，统一管理所有模块的启动、运行、停止。
    """
    def __init__(
        self,
        config: Any,
        kernel_endpoint: str,
        generation: str,
        registration_nonce: str,
        registration_secret: bytearray,
        memory_jobs_owner: str = "legacy",
    ):
        """
        初始化AI核心
        参数：
            config: 内核注入的全局冻结配置
            kernel_endpoint: KernelControlService 动态回环端点
            generation: Kernel 分配给受监督 Cognition 进程的世代
        异常：
            ConfigException: 配置校验失败时抛出
        """
        if memory_jobs_owner not in {"legacy", "external"}:
            raise ValueError("Memory Jobs owner 无效")
        self.memory_jobs_owner: Final[str] = memory_jobs_owner
        # 全局冻结配置，会话期不可修改
        self.config: Final[Any] = config
        self.kernel_endpoint: Final[str] = kernel_endpoint
        self.generation: Final[str] = generation
        self.registration_nonce: Final[str] = registration_nonce
        self.registration_secret: bytearray | None = registration_secret
        self.components: Any | None = None
        self.kernel_client: KernelGrpcClient | None = None
        self.cognition_grpc_host: CognitionGrpcHost | None = None
        # 运行状态
        self._is_running: bool = False
        # 主运行任务
        self._main_task: asyncio.Task | None = None
        self._last_state_sync_fingerprint: str | None = None
        self._last_state_sync_at: float = 0.0
        self._shutdown_task: asyncio.Task | None = None
        self.readiness = ReadinessTracker(WORKER_READY_COMPONENTS)
        self._shutdown_coordinator: ShutdownCoordinator | None = None
        self._shutdown_reported = False

        logger.info("Cognition 认知核初始化完成", name=config.manifest.base.name)

    async def start(self) -> None:
        """
        启动AI核心，按顺序初始化所有模块
        规范：幂等性，重复调用不会产生副作用
        """
        if self._is_running:
            logger.warning("Cognition 认知核已在运行中，无需重复启动")
            return
        self._shutdown_coordinator = None
        self._shutdown_reported = False
        self.readiness.begin_startup()

        try:
            logger.info("Cognition 认知核开始启动")

            from glimmer_cradle.cognition_worker.composition import compose_cognition

            registration_secret = self.registration_secret
            if registration_secret is None:
                raise RuntimeError("Cognition 注册 capability 已失效")
            self.kernel_client = KernelGrpcClient(
                self.generation,
                self.registration_nonce,
                registration_secret,
            )
            self.components = compose_cognition(
                self.config,
                action_sink=self.kernel_client.send_action_command,
                capability_rpc=self.kernel_client,
                observability=FileObservability(),
                model_invocation_recorder=record_model_invocation,
                memory_jobs_owner=self.memory_jobs_owner,
            )
            components = self._require_components()
            self.cognition_grpc_host = CognitionGrpcHost(
                generation=self.generation,
                inbound=components.inbound_adapter,
                queue=components.observation_queue,
                activity=components.activity_controller,
                cycle=components.cycle_controller,
                shutdown=self._accept_shutdown_request,
                operations=components.perception_operations,
                workspace=components.workspace,
                readiness=self.readiness,
                consolidation=components.consolidation_coordinator,
                planning=components.planning_store,
                conversation=components.conversation_recorder,
            )

            # 1.5 启动 Conversation Log 单写者。
            #     先确立进程级 boot_id（telemetry 层用），交互事实流本身是连续的，
            #     不写 SESSION_START/EPOCH_START 这类"生命周期事件" —— 那是 telemetry 的事。
            set_boot_id(new_boot_id())
            conversation_recorder = components.conversation_recorder
            await conversation_recorder.start()
            self.readiness.mark_ready("conversation_log")

            # 先启动 metrics 与 tracer，保留启动期诊断。
            #     须在记忆/知识加载之前 —— 启动期的 gauge / span 才不会丢。
            worker_paths = WorkerPaths.from_environment()
            await start_metrics(worker_paths.observability_dir / "metrics")
            await start_tracer(worker_paths.observability_dir / "traces")

            # 状态库先于认知活动恢复，保证首拍可读取持久状态与完整 policy。
            await components.state_store.connect()
            await components.planning_store.connect()
            await components.knowledge_store.connect()
            await components.checkpoint_store.connect()
            self.readiness.mark_ready("state_stores")
            activity_controller = components.activity_controller
            activity_controller.on_transition(self._request_state_sync)
            await activity_controller.start()

            # 1.66 先连接事实库并恢复投影，认知循环不得在 repository ready 前消费输入。
            cognition_database = components.cognition_database
            await cognition_database.connect()
            await cognition_database.select_consolidation_dispatch(self.memory_jobs_owner)
            await components.turn_controller.connect()
            await components.conversation_controller.connect()
            await components.memory_substrate.load()
            await components.knowledge_base.load_persisted()
            await components.maintenance_scheduler.start()
            self.readiness.mark_ready("projections")

            # 1.67 启动认知循环。
            await components.cycle_controller.start()
            self.readiness.mark_ready("loop")

            # 2. 先绑定受监督入站 Service，再向 Kernel 注册动态端点。
            await self.cognition_grpc_host.start()
            await self.kernel_client.start(
                self.kernel_endpoint,
                self.cognition_grpc_host.endpoint,
            )
            self.readiness.mark_ready("kernel_registration")

            # 3. 唤醒当前角色
            character_session = components.character_session
            character_session.wake_up()
            self.readiness.mark_ready("character")

            # 4. 发出首条状态同步消息。启动快照用于建立 Kernel/Renderer 投影，
            # 不代表一次认知活动状态转换。
            await self._send_state_sync_if_needed(force=True)
            self.readiness.mark_ready("initial_state_sync")

            # 5. 标记为运行中
            self._is_running = True

            # 6. 启动主运行循环
            self._main_task = asyncio.create_task(self._main_loop())

            logger.info("Cognition 认知核启动成功，当前角色已醒来")

        except Exception as e:
            logger.critical(f"Cognition 认知核启动失败: {str(e)}", exc_info=True)
            await self.stop()
            raise e
        finally:
            if self.registration_secret is not None:
                self.registration_secret[:] = b"\0" * len(self.registration_secret)
                self.registration_secret = None

    async def stop(self) -> None:
        """停机图由唯一 coordinator 持有；取消一个等待者不取消资源回收。"""
        if self._shutdown_coordinator is None:
            self.readiness.begin_shutdown()
            self._is_running = False
            self._shutdown_coordinator = ShutdownCoordinator(*worker_shutdown_steps(
                self.components,
                stop_main=self._stop_main_loop,
                stop_rpc=self._stop_rpc_service,
                stop_kernel=self._stop_kernel_client,
                stop_metrics=stop_metrics,
                stop_tracer=stop_tracer,
            ))
        failures = await self._shutdown_coordinator.run()
        self.readiness.mark_stopped()
        if not self._shutdown_reported:
            self._shutdown_reported = True
            for component, error in failures:
                logger.error("Worker 组件停机失败", component=component, error=str(error))
            logger.info("Cognition 认知核已停止，当前角色已进入休眠")

    async def _stop_main_loop(self) -> None:
        try:
            await cancel_task(self._main_task)
        finally:
            self._main_task = None

    async def _stop_rpc_service(self) -> None:
        try:
            if self.cognition_grpc_host is not None:
                await self.cognition_grpc_host.stop()
        finally:
            self.cognition_grpc_host = None

    async def _stop_kernel_client(self) -> None:
        try:
            if self.kernel_client is not None:
                await self.kernel_client.stop()
        finally:
            self.kernel_client = None

    async def _accept_shutdown_request(self) -> None:
        if self._shutdown_task is None or self._shutdown_task.done():
            self._shutdown_task = asyncio.create_task(self._shutdown_after_ack())

    async def _shutdown_after_ack(self) -> None:
        # 先让 gRPC 返回 ACK，再关闭承载该请求的 Service。
        await asyncio.sleep(0.05)
        await self.stop()
        asyncio.get_running_loop().stop()

    async def _main_loop(self) -> None:
        """主运行循环，保持进程运行，处理心跳和状态同步"""
        logger.info("主运行循环已启动")
        while self._is_running:
            try:
                # 同步当前状态给内核：语义变化立即同步，低频兜底刷新。
                await self._send_state_sync_if_needed()

                await asyncio.sleep(STATE_SYNC_LOOP_INTERVAL_S)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"主运行循环异常: {str(e)}", exc_info=True)
                await asyncio.sleep(1)

    def _request_state_sync(self) -> None:
        if not self._is_running:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self._send_state_sync_if_needed(force=True))

    async def _send_state_sync_if_needed(self, *, force: bool = False) -> None:
        if self.components is None:
            return

        character_session = self.components.character_session
        state = character_session.get_state()
        fingerprint = self._state_sync_fingerprint(state)
        now = asyncio.get_running_loop().time()
        elapsed = now - self._last_state_sync_at

        if (
            not force
            and fingerprint == self._last_state_sync_fingerprint
            and elapsed < STATE_SYNC_FALLBACK_INTERVAL_S
        ):
            return

        if self.kernel_client is None:
            return
        await self.kernel_client.send_state_sync(state)
        self._last_state_sync_fingerprint = fingerprint
        self._last_state_sync_at = now

    def _require_components(self) -> Any:
        if self.components is None:
            raise RuntimeError("Cognition 尚未完成组件组装")
        return self.components

    @staticmethod
    def _state_sync_fingerprint(state: dict) -> str:
        """构建状态同步指纹。

        `cognitive_activity.idle_seconds` 属于持续流逝的时间投影，不应让每秒快照
        都变成语义变化。真正触发同步的是 emotion 与 activity state/policy。
        """
        activity = state.get("cognitive_activity") if isinstance(state, dict) else None
        stable_activity = {}
        if isinstance(activity, dict):
            stable_activity = {
                "state": activity.get("state"),
                "since_at": activity.get("since_at"),
                "policy": activity.get("policy"),
            }

        stable = {
            "name": state.get("name"),
            "is_awake": state.get("is_awake"),
            "emotion": state.get("emotion"),
            "memory_count": state.get("memory_count"),
            "cognitive_activity": stable_activity,
        }
        return json.dumps(stable, sort_keys=True, ensure_ascii=False, default=str)


def _read_supervisor_bootstrap() -> dict[str, str]:
    """从仅由 Kernel 受监督子进程继承的匿名管道读取一次性注册能力。"""
    try:
        with os.fdopen(3, "r", encoding="utf-8", closefd=True) as bootstrap_pipe:
            payload = bootstrap_pipe.readline(16_384)
    except OSError as error:
        raise ValueError("缺少 Kernel 受监督 bootstrap pipe") from error
    value = json.loads(payload)
    if not isinstance(value, dict):
        raise ValueError("Kernel bootstrap payload 格式无效")
    return value


# ======================================
# 命令行启动入口
# ======================================
def main(argv: list[str] | None = None) -> int:
    """
    Cognition 认知核唯一命令行启动入口
    由 Kernel 受监督子进程启动；配置来自参数/环境，注册能力只来自 FD3 匿名管道。
    """
    # 解析命令行参数
    parser = argparse.ArgumentParser(description="Glimmer Cradle Cognition 认知核")
    parser.add_argument(
        "--config-json",
        type=str,
        required=False,
        help="JSON格式的全局配置字符串，由Kernel 内核注入（优先）"
    )
    parser.add_argument("--memory-jobs-owner", choices=("legacy", "external"), default="legacy",
                        help="受监督装配的 Memory Jobs owner；external 不允许回退为旧队列")
    args = parser.parse_args(argv)

    # 角色配置可通过环境变量注入；endpoint/generation/challenge 不进入环境。
    registration_secret: bytearray | None = None
    try:
        import json

        config_json = args.config_json or os.environ.get("GLIMMER_CRADLE_CONFIG")
        bootstrap = _read_supervisor_bootstrap()
        kernel_endpoint = str(bootstrap.pop("kernelEndpoint"))
        generation = str(bootstrap.pop("generation"))
        registration_nonce = str(bootstrap.pop("registrationNonce"))
        registration_secret_text = str(bootstrap.pop("registrationSecret"))
        registration_secret = bytearray(base64.urlsafe_b64decode(
            registration_secret_text + "=" * (-len(registration_secret_text) % 4)
        ))
        registration_secret_text = ""
        bootstrap.clear()

        if not config_json or not kernel_endpoint or not generation or not registration_nonce or not registration_secret:
            raise ValueError("缺少 Cognition 启动配置、Kernel gRPC endpoint 或 generation")

        config_dict = json.loads(config_json)
        from glimmer_cradle.cognition_worker.composition import (
            map_character_runtime_document,
        )

        config = map_character_runtime_document(config_dict)
    except Exception as e:
        if registration_secret is not None:
            registration_secret[:] = b"\0" * len(registration_secret)
        logger.critical(f"配置解析失败: {str(e)}", exc_info=True)
        return 1

    # 创建认知核实例
    cognition_host = CognitionHost(
        config=config,
        kernel_endpoint=kernel_endpoint,
        generation=generation,
        registration_nonce=registration_nonce,
        registration_secret=registration_secret,
        memory_jobs_owner=args.memory_jobs_owner,
    )

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    exit_code = 0

    # 优雅停机信号
    import signal

    async def shutdown() -> None:
        await cognition_host.stop()
        loop.stop()

    def _register_signal(sig: signal.Signals) -> None:
        try:
            loop.add_signal_handler(sig, lambda: asyncio.create_task(shutdown()))
        except NotImplementedError:
            # Windows 的同步 signal handler 只负责把停机任务投递回事件循环。
            signal.signal(
                sig,
                lambda *_: loop.call_soon_threadsafe(
                    lambda: asyncio.create_task(shutdown())
                ),
            )

    for sig in (signal.SIGINT, signal.SIGTERM):
        _register_signal(sig)

    # 启动认知核
    try:
        loop.run_until_complete(cognition_host.start())
        loop.run_forever()
    except KeyboardInterrupt:
        logger.info("收到停机信号，正在优雅关闭...")
    except Exception as e:
        logger.critical(f"Cognition 认知核运行异常: {str(e)}", exc_info=True)
        exit_code = 1
    finally:
        try:
            if not loop.is_closed():
                loop.run_until_complete(cognition_host.stop())
        except Exception as e:
            logger.critical(f"Cognition 认知核停机异常: {str(e)}", exc_info=True)
            exit_code = 1
        finally:
            loop.close()
            asyncio.set_event_loop(None)
    return exit_code

# 直接运行时启动
if __name__ == "__main__":
    raise SystemExit(main())
