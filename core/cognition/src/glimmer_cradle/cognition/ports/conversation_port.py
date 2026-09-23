"""Cognition's required view of durable Conversation facts."""

from __future__ import annotations

from typing import Protocol

from glimmer_cradle.conversation import Moment


class ConversationPort(Protocol):
    async def append(self, moment: Moment) -> str: ...

    async def recent(
        self,
        *,
        conversation_id: str,
        thread_id: str,
        limit: int,
    ) -> tuple[Moment, ...]: ...

    async def flush(self) -> None: ...
