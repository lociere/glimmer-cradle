"""Ordered Conversation records 到 History 的幂等投影协调器。"""

from __future__ import annotations

from glimmer_cradle.conversation.history.checkpoint import (
    ConversationHistoryStorePort,
    ProjectionCheckpoint,
)
from glimmer_cradle.conversation.log.reader import ConversationLogReaderPort


class HistoryProjection:
    def __init__(
        self,
        *,
        store: ConversationHistoryStorePort,
        recorder: ConversationLogReaderPort,
    ) -> None:
        self._store = store
        self._recorder = recorder
        self._connected = False

    async def connect(self) -> set[tuple[str, str]]:
        if self._connected:
            return set()
        await self._store.connect()
        self._connected = True
        try:
            _, affected = await self.project_pending()
            return affected
        except Exception:
            await self._store.close()
            self._connected = False
            raise

    async def close(self) -> set[tuple[str, str]]:
        if not self._connected:
            return set()
        try:
            _, affected = await self.project_pending()
            return affected
        finally:
            await self._store.close()
            self._connected = False

    async def project_pending(self) -> tuple[int, set[tuple[str, str]]]:
        if not self._connected:
            raise RuntimeError("HistoryProjection 尚未连接")
        await self._recorder.flush()
        checkpoint = ProjectionCheckpoint(await self._store.checkpoint())
        moments = self._recorder.moments_after(checkpoint.position)
        affected: set[tuple[str, str]] = set()
        for moment in moments:
            if await self._store.project(moment) and moment.conversation_id:
                affected.add((moment.conversation_id, moment.thread_id))
        return len(moments), affected


__all__ = ["HistoryProjection"]
