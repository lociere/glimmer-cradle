"""
全局结构化日志器
─────────────────────────────────────────
• 输出目标  控制台（stdout）+ 主日志文件 + 错误专属日志文件
• 控制台    默认输出纯 JSON（与 Kernel 内核解析格式对齐）；
            设置 PRETTY_LOGS=1 可在开发时切换为人类可读的彩色格式
• 文件      始终输出 JSON，便于后续离线分析
• 轮转策略  主日志 10 MB × 5；错误日志 5 MB × 3
• 幂等性    重复 import 或调用不会重复添加 handler
• 未捕获异常 通过 sys.excepthook 捕获并写入 CRITICAL 级别日志
"""

from __future__ import annotations

import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

import structlog
from structlog.stdlib import ProcessorFormatter

from glimmer_cradle.cognition.foundation.path_utils import ensure_dir, resolve_global_log_dir
from glimmer_cradle.cognition.observability.trace_context import trace_context_processor


# ──────────────────────────────────────────────────────────────────────────────
# 跨语言对齐处理器
#   时间戳：截断 microseconds → milliseconds（Python iso 默认 6 位小数；
#           TypeScript 端 Date.toISOString 是 3 位）。协议层规定 3 位，Python 截掉多余位
#   level 名称：Python stdlib "warning" → 协议规定的 "warn"
# 见 docs/architecture/08-记忆与日志架构.md §3.3.6
# ──────────────────────────────────────────────────────────────────────────────


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
    return ensure_dir(resolve_global_log_dir())


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
