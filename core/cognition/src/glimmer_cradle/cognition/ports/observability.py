"""Cognition 热路径使用的可观测性外部能力。"""

from __future__ import annotations

from contextlib import nullcontext
from typing import Any, Callable, Protocol


class LoggerPort(Protocol):
    def debug(self, event: str, **values: Any) -> Any: ...
    def info(self, event: str, **values: Any) -> Any: ...
    def warning(self, event: str, **values: Any) -> Any: ...
    def error(self, event: str, **values: Any) -> Any: ...
    def critical(self, event: str, **values: Any) -> Any: ...


class _NullLogger:
    def debug(self, event: str, **values: Any) -> None: pass
    def info(self, event: str, **values: Any) -> None: pass
    def warning(self, event: str, **values: Any) -> None: pass
    def error(self, event: str, **values: Any) -> None: pass
    def critical(self, event: str, **values: Any) -> None: pass


class _NullSpan:
    def set_attribute(self, name: str, value: Any) -> None: pass
    def add_event(self, name: str, attributes: dict | None = None) -> None: pass


def _default_logger_factory(_name: str) -> LoggerPort:
    return _NullLogger()


def _default_metric_sink(_name: str, _value: float, _labels: dict | None) -> None:
    return None


def _default_span_factory(*_args: Any, **_kwargs: Any) -> Any:
    return nullcontext(_NullSpan())


_logger_factory: Callable[[str], LoggerPort] = _default_logger_factory
_counter: Callable[[str, float, dict | None], None] = _default_metric_sink
_gauge: Callable[[str, float, dict | None], None] = _default_metric_sink
_histogram: Callable[[str, float, dict | None], None] = _default_metric_sink
_span_factory: Callable[..., Any] = _default_span_factory


def bind_observability(
    *,
    logger_factory: Callable[[str], LoggerPort],
    counter_sink: Callable[[str, float, dict | None], None],
    gauge_sink: Callable[[str, float, dict | None], None],
    histogram_sink: Callable[[str, float, dict | None], None],
    span_factory: Callable[..., Any],
) -> None:
    global _logger_factory, _counter, _gauge, _histogram, _span_factory
    _logger_factory = logger_factory
    _counter = counter_sink
    _gauge = gauge_sink
    _histogram = histogram_sink
    _span_factory = span_factory


def get_logger(module_name: str) -> LoggerPort:
    return _logger_factory(module_name)


def counter(name: str, value: float = 1, labels: dict | None = None) -> None:
    _counter(name, value, labels)


def gauge(name: str, value: float, labels: dict | None = None) -> None:
    _gauge(name, value, labels)


def histogram(name: str, value: float, labels: dict | None = None) -> None:
    _histogram(name, value, labels)


def span(*args: Any, **kwargs: Any) -> Any:
    return _span_factory(*args, **kwargs)
