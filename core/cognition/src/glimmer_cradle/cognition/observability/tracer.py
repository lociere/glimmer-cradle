"""
文件名称：tracer.py
所属层级：可观测性层（Observability）
核心作用：遥测三支柱之 ③ —— span（trace 内一个原子操作）

设计原则（Glimmer Cradle 架构蓝图 §6.2）：
1. span 是 telemetry 层概念，结构对齐 OpenTelemetry Span，未来加 exporter 即可对外。
2. ``span(name)`` 是廉价同步上下文管理器：进入 = 新建 + 设当前 span_id；退出 = 记录
   + 写入异步缓冲。不阻塞认知热路径。
3. 嵌套：父 span 通过 contextvar 自动传递，子 span 退出后还原。
4. 跨进程：调用方在 IPC 信封透传 ``trace_id`` + ``span_id``，被调方入站用
   ``with_remote_parent_span`` 把它们建为父上下文，子 span 自动挂到下面。
5. 未启动（如测试或启动早期）时 ``span()`` 仍可用，仅缓冲会被丢弃。
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.observability.trace_context import (
    _span_id_var,
    _trace_id_var,
    get_current_boot_id,
    get_current_span_id,
    get_current_trace_id,
    new_trace_id,
)

logger = get_logger("tracer")


def _now_iso_ms() -> str:
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
        logger.info("span 写入器已启动", path=str(self._path))

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self.flush()
        logger.info("span 写入器已停止")

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
            logger.warning("span 文件轮转失败", error=str(exc))

    async def _flush_loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(self._flush_interval)
                await self.flush()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("span flush 异常", error=str(exc), exc_info=True)


# ── 模块级门面：全进程唯一写入器 ──────────────────────────────────────────────

_writer: SpanWriter | None = None


async def start_tracer(traces_dir: Path, *, proc: str = "cognition") -> None:
    """启动 span 写入器（由 CognitionHost 启动序列调用）。"""
    global _writer
    if _writer is not None:
        return
    _writer = SpanWriter(traces_dir, proc=proc)
    await _writer.start()


async def stop_tracer() -> None:
    """停止 span 写入器（落盘剩余缓冲）。"""
    global _writer
    if _writer is not None:
        await _writer.stop()
        _writer = None


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
        self._started_at = _now_iso_ms()
        self._started_mono = time.monotonic()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        duration_ms = (time.monotonic() - self._started_mono) * 1000.0
        if exc_type is not None and self._status == "ok":
            self._status = "error"
            self._error = exc_type.__name__
        ended_at = _now_iso_ms()
        if _writer is not None:
            _writer.append(SpanEvent(
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
