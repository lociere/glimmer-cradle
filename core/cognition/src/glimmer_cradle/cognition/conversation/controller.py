"""Experience 到 Conversation 投影、恢复与检索的唯一 owner。"""

from __future__ import annotations

from glimmer_cradle.cognition.conversation.models import ConversationWorkingSet
from glimmer_cradle.cognition.conversation.store import ConversationStore


class ConversationController:
    def __init__(self, *, store: ConversationStore, recorder, working_config) -> None:
        self._store = store
        self._recorder = recorder
        self._working_config = working_config
        self._working_sets: dict[str, ConversationWorkingSet] = {}
        self._connected = False

    async def connect(self) -> None:
        if self._connected:
            return
        await self._store.connect()
        self._connected = True
        try:
            await self.project_pending()
        except Exception:
            await self._store.close()
            self._connected = False
            raise

    async def close(self) -> None:
        if not self._connected:
            self._working_sets.clear()
            return
        try:
            await self.project_pending()
        finally:
            self._working_sets.clear()
            await self._store.close()
            self._connected = False

    async def project_pending(self) -> int:
        if not self._connected:
            raise RuntimeError("ConversationController 尚未连接")
        await self._recorder.flush()
        checkpoint = await self._store.checkpoint()
        moments = self._recorder.moments_after(checkpoint)
        affected: set[str] = set()
        for moment in moments:
            if await self._store.project(moment) and moment.conversation_id:
                affected.add(moment.conversation_id)
        for conversation_id in affected:
            self._working_sets.pop(conversation_id, None)
        return len(moments)

    async def working_set(self, conversation_id: str) -> ConversationWorkingSet:
        await self.project_pending()
        working_set = self._working_sets.setdefault(
            conversation_id, ConversationWorkingSet(conversation_id=conversation_id)
        )
        async with working_set.lock:
            if not working_set.hydrated:
                state, messages = await self._store.load_working_set(
                    conversation_id,
                    limit=min(
                        self._working_config.hydrate_recent_messages,
                        self._working_config.max_messages_per_conversation,
                    ),
                )
                working_set.state = state
                working_set.messages = messages
                working_set.hydrated = True
        return working_set

    async def prompt_context(
        self, conversation_id: str, query: str, *, allowed_scopes: set[str]
    ) -> tuple[str, str, str]:
        if not conversation_id:
            return "", "", ""
        working_set = await self.working_set(conversation_id)
        async with working_set.lock:
            state = (
                self._format_state(working_set.state)
                if working_set.state.get("_recall_scope") in allowed_scopes
                else ""
            )
            recent = "\n".join(
                item.prompt_line()
                for item in working_set.recent(self._working_config.context_message_limit)
                if item.recall_scope in allowed_scopes
            )
        segments = await self._store.retrieve_segments(
            conversation_id, query, allowed_scopes=allowed_scopes,
            limit=self._store.history_result_limit,
        )
        return state, recent, "\n".join(f"历史片段：{item}" for item in segments)

    @staticmethod
    def _format_state(state: dict) -> str:
        if not state:
            return ""
        lines = []
        if state.get("active_topic"):
            lines.append(f"当前话题：{state['active_topic']}")
        for question in state.get("open_questions", []):
            lines.append(f"未决问题：{question}")
        return "\n".join(lines)
