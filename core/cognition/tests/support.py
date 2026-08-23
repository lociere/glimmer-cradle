from __future__ import annotations

import asyncio
import hashlib
from contextlib import contextmanager
from datetime import datetime, timezone

from glimmer_cradle.cognition.adapters.observability.trace_context import (
    TraceContext,
    get_current_trace_id,
)


class TestClock:
    def __init__(self) -> None:
        self.value = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)

    def now(self) -> datetime:
        return datetime.now(timezone.utc)

    def now_iso(self) -> str:
        return self.now().isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def monotonic(self) -> float:
        return self.now().timestamp()

    async def wait(self, seconds: float) -> None:
        await asyncio.sleep(seconds)


class TestIds:
    def __init__(self) -> None:
        self._next = 0

    def new(self) -> str:
        self._next += 1
        return f"{self._next:032x}"

    def stable(self, namespace: str, value: str) -> str:
        return hashlib.sha256(f"{namespace}:{value}".encode()).hexdigest()[:32]


class RecordingLogger:
    def __init__(self, records: list[tuple[str, str, dict]], name: str) -> None:
        self._records = records
        self._name = name

    def _record(self, level: str, event: str, values: dict) -> None:
        self._records.append((level, f"{self._name}:{event}", values))

    def debug(self, event: str, **values) -> None: self._record("debug", event, values)
    def info(self, event: str, **values) -> None: self._record("info", event, values)
    def warning(self, event: str, **values) -> None: self._record("warning", event, values)
    def error(self, event: str, **values) -> None: self._record("error", event, values)
    def critical(self, event: str, **values) -> None: self._record("critical", event, values)


class RecordingSpan:
    def __init__(self) -> None:
        self.attributes: dict = {}
        self.events: list[tuple[str, dict | None]] = []

    def set_attribute(self, name: str, value) -> None:
        self.attributes[name] = value

    def add_event(self, name: str, attributes: dict | None = None) -> None:
        self.events.append((name, attributes))


class RecordingObservability:
    def __init__(self) -> None:
        self.logs: list[tuple[str, str, dict]] = []
        self.metrics: list[tuple[str, str, float, dict | None]] = []
        self._ids = TestIds()

    def logger(self, module_name: str) -> RecordingLogger:
        return RecordingLogger(self.logs, module_name)

    def counter(self, name: str, value: float = 1, labels: dict | None = None) -> None:
        self.metrics.append(("counter", name, value, labels))

    def gauge(self, name: str, value: float, labels: dict | None = None) -> None:
        self.metrics.append(("gauge", name, value, labels))

    def histogram(self, name: str, value: float, labels: dict | None = None) -> None:
        self.metrics.append(("histogram", name, value, labels))

    @contextmanager
    def span(self, name: str, *, attributes: dict | None = None):
        span = RecordingSpan()
        span.attributes.update(attributes or {})
        yield span

    def trace_context(self, trace_id: str):
        return TraceContext(trace_id)

    def new_trace_id(self) -> str:
        return self._ids.new()

    def current_trace_id(self) -> str | None:
        return get_current_trace_id()


CLOCK = TestClock()
IDS = TestIds()
OBSERVABILITY = RecordingObservability()


def recorder_args() -> dict:
    return {"clock": CLOCK, "ids": IDS, "observability": OBSERVABILITY}


def build_experience_recorder(base_dir, **kwargs):
    from glimmer_cradle.cognition.adapters.persistence.experience.factory import (
        build_experience_recorder as build,
    )

    return build(base_dir, **recorder_args(), **kwargs)
