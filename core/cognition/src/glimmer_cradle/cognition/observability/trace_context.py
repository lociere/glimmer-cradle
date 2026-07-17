"""
trace 上下文（telemetry 侧）
─────────────────────────────────────────
设计目的：让事件驱动系统中所有相关的日志、IPC 消息、错误能通过同一个
trace_id 串联——无需调用方在每个函数签名里手动透传。

工作机制：
- contextvars 在 asyncio 任务边界自动隔离（每个 Task 一份独立 stack）
- 入口（如 IPC 入站、扩展回调）用 ``with TraceContext(trace_id):`` 包住业务逻辑
- 业务代码内部不需要感知 trace_id 的存在，logger 自动注入
- 子 Task（``asyncio.create_task``）继承父 Task 的 contextvars 快照

字段约定：日志字段名固定为 ``trace_id`` / ``span_id`` / ``boot_id``，
与 Kernel 内核 / 协议层保持一致。注意：trace_id / span_id 只活在 **telemetry**
层，对齐 W3C TraceContext / OpenTelemetry；角色的"经历"用 Moment + causation_ids
表达因果（见 experience/events.py），不再依赖 trace 层。

参考：docs/architecture/blueprint/微光摇篮架构蓝图.md §4.1 / §6.2、
      docs/architecture/current/log-fields-glossary.md §5.4
"""

from __future__ import annotations

import contextvars
import uuid
from typing import Any, Optional

# ──────────────────────────────────────────────────────────────────────────────
# ContextVar
# ──────────────────────────────────────────────────────────────────────────────

# 使用 default=None 而非 sentinel，方便 logger processor 简单判空
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
