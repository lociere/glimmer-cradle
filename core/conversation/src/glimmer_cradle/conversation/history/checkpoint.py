"""History 投影 checkpoint 与持久化消费边界。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from glimmer_cradle.conversation.log.record import ConversationFact
from glimmer_cradle.conversation.messages.message import ConversationMessage


@dataclass(frozen=True, slots=True)
class ProjectionCheckpoint:
    position: int = 0

    def __post_init__(self) -> None:
        if self.position < 0:
            raise ValueError("History checkpoint 不得为负数")


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


__all__ = ["ConversationHistoryStorePort", "ProjectionCheckpoint"]
