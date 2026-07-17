"""
文件名称：metrics.py
所属层级：可观测性层（Observability）
核心作用：遥测三支柱之 ② —— metrics（counter / gauge / histogram 事件流）
设计原则：
1. metric() 廉价：仅入内存缓冲，后台批量落盘，绝不拖慢认知热路径
2. 事件流而非时序数据库 —— append 到 data/observability/metrics/*.jsonl，单机够用
3. 每条 metric 自动带 boot/trace 上下文（蓝图 §6.2），与运营日志可对齐
4. 未启动（如测试 / 启动早期）时 metric() 为无操作，安全
"""
from __future__ import annotations

import asyncio
import json
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.observability.trace_context import (
    get_current_boot_id,
    get_current_trace_id,
)
# MetricKind 直接消费由协议 Schema 生成的单一事实源。
from glimmer_cradle.cognition.protocol.generated.enums.metric_kind import MetricKind

logger = get_logger("metrics")

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


def _now_iso_ms() -> str:
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
        logger.info("metrics 写入器已启动", path=str(self._path))

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self.flush()
        logger.info("metrics 写入器已停止")

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
            logger.warning("metrics 文件轮转失败", error=str(exc))

    async def _flush_loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(self._flush_interval)
                await self.flush()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("metrics flush 异常", error=str(exc), exc_info=True)


# ── 模块级门面：全进程唯一写入器 ──────────────────────────────────────────────

_writer: MetricsWriter | None = None


async def start_metrics(metrics_dir: Path, *, proc: str = "cognition") -> None:
    """启动 metrics 写入器（由 CognitionHost 启动序列调用）。"""
    global _writer
    if _writer is not None:
        return
    _writer = MetricsWriter(metrics_dir, proc=proc)
    await _writer.start()


async def stop_metrics() -> None:
    """停止 metrics 写入器（落盘剩余缓冲）。"""
    global _writer
    if _writer is not None:
        await _writer.stop()
        _writer = None


def metric(name: str, kind: MetricKind | str, value: float, labels: dict | None = None) -> None:
    """记录一条 metric。未启动时为无操作 —— 自动带 boot/trace 上下文。"""
    if _writer is None:
        return
    _writer.append(MetricEvent(
        ts=_now_iso_ms(),
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
            logger.warning("metrics label 已丢弃（不在白名单）", metric_name=name, label_key=key)
            continue
        sanitized[key] = value
    return sanitized
