"""Conversation application 所需的存储与 ordered log 边界。"""

from __future__ import annotations

from typing import Any, Protocol

from glimmer_cradle.conversation.log.fact import ConversationFact
from glimmer_cradle.conversation.message.models import ConversationMessage


class ConversationLogReaderPort(Protocol):
    @property
    def log(self) -> ConversationLogPort: ...

    async def flush(self) -> None: ...

    def moments_after(self, position: int) -> list[ConversationFact]: ...


class ConversationLogPort(Protocol):
    @property
    def base_dir(self) -> object: ...

    async def start(self) -> None: ...

    async def stop(self) -> None: ...

    async def flush(self) -> None: ...

    def append(self, moment: ConversationFact) -> ConversationFact: ...

    def query(
        self, *, after_position: int = 0, limit: int | None = None
    ) -> list[ConversationFact]: ...

    def recent(
        self,
        *,
        limit: int,
        kinds: set[str] | None = None,
        scene_id: str | None = None,
        exclude_trace_id: str | None = None,
    ) -> list[ConversationFact]: ...

    def verify(self) -> dict[str, object]: ...


class ClockPort(Protocol):
    def now_iso(self) -> str: ...

    async def wait(self, seconds: float) -> None: ...


class IdGeneratorPort(Protocol):
    def new(self) -> str: ...


class LoggerPort(Protocol):
    def info(self, event: str, **values: Any) -> Any: ...

    def warning(self, event: str, **values: Any) -> Any: ...

    def error(self, event: str, **values: Any) -> Any: ...


class ObservabilityPort(Protocol):
    def logger(self, module_name: str) -> LoggerPort: ...

    def current_trace_id(self) -> str | None: ...


class ConversationHistoryStorePort(Protocol):
    @property
    def history_result_limit(self) -> int: ...

    async def connect(self) -> None: ...

    async def close(self) -> None: ...

    async def checkpoint(self) -> int: ...

    async def project(self, moment: ConversationFact) -> bool: ...

    async def load_working_set(
        self, conversation_id: str, thread_id: str, *, limit: int
    ) -> tuple[dict, list[ConversationMessage]]: ...

    async def retrieve_segments(
        self,
        conversation_id: str,
        thread_id: str,
        query: str,
        *,
        allowed_scopes: set[str],
        limit: int,
    ) -> list[str]: ...

    async def load_history_page(
        self,
        conversation_id: str,
        thread_id: str,
        *,
        allowed_scopes: set[str],
        cursor: str | None,
        limit: int,
        scene_id: str | None = None,
        actor_id: str | None = None,
    ) -> tuple[dict, list[ConversationMessage], str | None, bool]: ...
