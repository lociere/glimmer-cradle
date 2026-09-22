from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import uuid

import pytest

from glimmer_cradle.conversation import build_conversation_recorder


class _Clock:
    def now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    async def wait(self, seconds: float) -> None:
        await asyncio.sleep(seconds)


class _Ids:
    def new(self) -> str:
        return uuid.uuid4().hex


class _Logger:
    def info(self, _event: str, **_values) -> None: ...

    def warning(self, _event: str, **_values) -> None: ...

    def error(self, _event: str, **_values) -> None: ...


class _Observability:
    def logger(self, _module_name: str) -> _Logger:
        return _Logger()

    def current_trace_id(self) -> str | None:
        return None


@pytest.fixture
def recorder_factory():
    def build(path: Path):
        return build_conversation_recorder(
            path,
            clock=_Clock(),
            ids=_Ids(),
            observability=_Observability(),
            flush_interval_ms=60_000,
        )

    return build


@pytest.fixture
def history_config():
    return SimpleNamespace(
        segment_target_messages=2,
        chapter_idle_minutes=360,
        chapter_segment_limit=8,
        state_update_messages=1,
        history_candidate_limit=12,
        history_result_limit=4,
        summary_max_chars=2400,
    )


@pytest.fixture
def working_config():
    return SimpleNamespace(
        max_messages_per_conversation=16,
        hydrate_recent_messages=16,
        context_message_limit=16,
    )
