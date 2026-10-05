import json
from contextlib import contextmanager
from pathlib import Path

import pytest


class DeterministicIds:
    def __init__(self) -> None:
        self._next = 0

    def new(self) -> str:
        self._next += 1
        return f"{self._next:032x}"

    def stable(self, namespace: str, value: str) -> str:
        return f"{namespace}:{value}"


class _NullLogger:
    def debug(self, _event: str, **_values) -> None: pass
    def info(self, _event: str, **_values) -> None: pass
    def warning(self, _event: str, **_values) -> None: pass
    def error(self, _event: str, **_values) -> None: pass
    def critical(self, _event: str, **_values) -> None: pass


class NullObservability:
    def logger(self, _module_name: str) -> _NullLogger:
        return _NullLogger()

    def counter(self, *_args, **_kwargs) -> None: pass
    def gauge(self, *_args, **_kwargs) -> None: pass
    def histogram(self, *_args, **_kwargs) -> None: pass

    @contextmanager
    def span(self, _name: str, *, attributes=None):
        del attributes
        yield type("Span", (), {"set_attribute": lambda *_: None, "add_event": lambda *_args, **_kwargs: None})()

    @contextmanager
    def trace_context(self, _trace_id: str):
        yield

    def new_trace_id(self) -> str:
        return "0" * 32

    def current_trace_id(self) -> str | None:
        return None


@pytest.fixture
def worker_config() -> dict[str, int]:
    path = Path(__file__).parent / "fixtures" / "worker-config.json"
    return json.loads(path.read_text(encoding="utf-8"))
