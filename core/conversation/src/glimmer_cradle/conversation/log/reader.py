"""Conversation Log 的只读消费边界。"""

from __future__ import annotations

from typing import Protocol

from glimmer_cradle.conversation.log.commit_barrier import CommitBarrier
from glimmer_cradle.conversation.log.record import ConversationFact
from glimmer_cradle.conversation.log.writer import ConversationLogPort


class ConversationLogReaderPort(CommitBarrier, Protocol):
    @property
    def log(self) -> ConversationLogPort: ...

    def moments_after(self, position: int) -> list[ConversationFact]: ...


__all__ = ["ConversationLogReaderPort"]
