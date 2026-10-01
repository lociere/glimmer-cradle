"""Context 来源激活、信任归一、排序、压缩与预算选择。"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Sequence

from glimmer_cradle.cognition.context.budget import ContextBudget
from glimmer_cradle.cognition.context.compaction import ContextCompactor
from glimmer_cradle.cognition.context.source import ContextItem, ContextQuery, ContextSource
from glimmer_cradle.cognition.context.trust import ContextTrustPolicy
from glimmer_cradle.cognition.ports.observability import ObservabilityPort
from glimmer_cradle.cognition.context.source import allowed_recall_scopes


_EMOTION_HINTS: dict[str, str] = {
    "calm": "平静",
    "happy": "开心",
    "shy": "害羞",
    "angry": "生气",
    "sulky": "委屈",
    "curious": "好奇",
    "sad": "难过",
}


@dataclass
class AssembledContext:
    items: list[ContextItem] = field(default_factory=list)
    total_tokens: int = 0
    budget_tokens: int = 0
    was_truncated: bool = False
    sources_called: int = 0
    sources_failed: int = 0

    def grouped_by_source(self) -> dict[str, list[ContextItem]]:
        groups: dict[str, list[ContextItem]] = {}
        for item in self.items:
            groups.setdefault(item.source, []).append(item)
        return groups

    def total_count(self) -> int:
        return len(self.items)


class ContextAssembler:
    def __init__(
        self,
        sources: Sequence[ContextSource],
        *,
        base_budget_tokens: int = 2000,
        weights: tuple[float, float, float] = (0.2, 0.3, 0.5),
        observability: ObservabilityPort,
        trust_policy: ContextTrustPolicy | None = None,
        compactor: ContextCompactor | None = None,
    ) -> None:
        self._sources = list(sources)
        self._budget = ContextBudget(base_budget_tokens)
        self._w_recency, self._w_importance, self._w_relevance = weights
        self._observability = observability
        self._logger = observability.logger("context_assembly")
        self._trust = trust_policy or ContextTrustPolicy()
        self._compactor = compactor or ContextCompactor()

    @property
    def sources(self) -> list[ContextSource]:
        return list(self._sources)

    async def assemble(
        self,
        query: ContextQuery,
        *,
        budget_factor: float = 1.0,
        per_source_limit: int = 10,
    ) -> AssembledContext:
        budget = self._budget.limit(budget_factor)
        with self._observability.span(
            "context_assembly", attributes={"budget_tokens": budget}
        ) as span:
            results = await asyncio.gather(
                *(self._safe_activate(source, query, per_source_limit) for source in self._sources),
                return_exceptions=False,
            )
            failed = sum(1 for result in results if result is None)
            all_items = [
                self._trust.enforce(item)
                for result in results
                if result
                for item in result
            ]
            self._observability.counter("context.sources_called", len(results))
            self._observability.counter("context.sources_failed", failed)
            self._observability.gauge("context.candidates_raw", float(len(all_items)))
            all_items.sort(
                key=lambda item: item.score(
                    w_recency=self._w_recency,
                    w_importance=self._w_importance,
                    w_relevance=self._w_relevance,
                ),
                reverse=True,
            )
            selected = self._budget.select(all_items, factor=budget_factor)
            picked = list(selected.items)
            if not picked and all_items and budget > 0:
                compacted = self._compactor.compact(all_items[0], max_tokens=budget)
                if compacted is not None:
                    picked = [compacted]
            used = sum(item.token_estimate for item in picked)
            was_truncated = len(picked) < len(all_items) or any(
                item.metadata.get("compacted") is True for item in picked
            )
            self._observability.histogram("context.tokens_used", float(used))
            span.set_attribute("candidates_total", len(all_items))
            span.set_attribute("picked", len(picked))
            span.set_attribute("was_truncated", was_truncated)
            return AssembledContext(
                items=picked,
                total_tokens=used,
                budget_tokens=budget,
                was_truncated=was_truncated,
                sources_called=len(results),
                sources_failed=failed,
            )

    async def _safe_activate(
        self, source: ContextSource, query: ContextQuery, max_items: int
    ) -> list[ContextItem] | None:
        try:
            return await source.activate(query, max_items=max_items)
        except Exception as error:
            self._logger.error(
                "ContextSource activate 异常",
                source=source.name,
                error=str(error),
                exc_info=True,
            )
            return None


class ReplyContextBuilder:
    """按固定分区装配角色回复所需的会话、记忆、知识和经历。"""

    def __init__(
        self,
        *,
        self_entity=None,
        conversation=None,
        recent_experience_source=None,
        observability: ObservabilityPort,
    ) -> None:
        self._entity = self_entity
        self._conversation = conversation
        self._experience = recent_experience_source
        self._logger = observability.logger("reply_context")

    async def build(
        self,
        *,
        persona_prompt: str,
        scene_id: str,
        conversation_id: str,
        thread_id: str,
        actor_id: str | None,
        recall_scope: str,
        user_text: str,
        emotion_state: dict,
        trace_id: str,
        multimodal_text: str = "",
    ) -> str:
        if self._entity is None:
            if not multimodal_text:
                return persona_prompt
            return self._compose(persona_prompt, {"multimodal": multimodal_text})
        context = await self._gather(
            scene_id=scene_id,
            conversation_id=conversation_id,
            thread_id=thread_id,
            actor_id=actor_id,
            recall_scope=recall_scope,
            user_text=user_text,
            emotion_state=emotion_state,
            trace_id=trace_id,
        )
        context["multimodal"] = multimodal_text
        return self._compose(persona_prompt, context)

    async def _gather(
        self,
        *,
        scene_id: str,
        conversation_id: str,
        thread_id: str,
        actor_id: str | None,
        recall_scope: str,
        user_text: str,
        emotion_state: dict,
        trace_id: str,
    ) -> dict[str, str]:
        context = {
            "conversation_state": "",
            "recent_dialogue": "",
            "historical_segments": "",
            "preference": "",
            "ltm": "",
            "knowledge": "",
            "experience": "",
        }
        emotion_hint = _EMOTION_HINTS.get(
            emotion_state.get("emotion_type", "") if isinstance(emotion_state, dict) else "",
            "",
        )
        query = "\n".join(part for part in [user_text, emotion_hint] if part).strip()
        allowed_scopes = allowed_recall_scopes(recall_scope)

        try:
            preferences = [
                item
                for item in self._entity.memory.all_current()
                if item.attributes.get("preference")
                and self._memory_visible(
                    item,
                    conversation_id=conversation_id,
                    actor_id=actor_id,
                    scene_id=scene_id,
                    allowed_scopes=allowed_scopes,
                )
            ]
            context["preference"] = "\n".join(
                f"偏好：{item.content}" for item in preferences
            )
        except Exception as exc:
            self._logger.debug("偏好记忆取用失败", error=str(exc))
        try:
            memories = await self._entity.memory.retrieve(
                query,
                actor_id=actor_id,
                scene_id=scene_id,
                conversation_id=conversation_id,
                allowed_scopes=allowed_scopes,
                limit=6,
            )
            context["ltm"] = "\n".join(f"记忆：{item.content}" for item in memories)
        except Exception as exc:
            self._logger.debug("相关记忆检索失败", error=str(exc))
        try:
            knowledge = await self._entity.knowledge_base.get_knowledge(query=query)
            context["knowledge"] = "\n".join(
                f"知识：{item.content}" for item in knowledge
            )
        except Exception as exc:
            self._logger.debug("世界知识取用失败", error=str(exc))
        if self._experience is not None:
            try:
                context["experience"] = self._experience.digest(
                    query,
                    scene_id=scene_id,
                    conversation_id=conversation_id,
                    actor_id=actor_id,
                    allowed_scopes=allowed_scopes,
                    current_trace_id=trace_id,
                    max_items=6,
                )
            except Exception as exc:
                self._logger.debug("近期经历取用失败", error=str(exc))
        try:
            if self._conversation is not None:
                (
                    context["conversation_state"],
                    context["recent_dialogue"],
                    context["historical_segments"],
                ) = await self._conversation.prompt_context(
                    conversation_id,
                    thread_id,
                    query,
                    allowed_scopes=allowed_scopes,
                )
        except Exception as exc:
            self._logger.debug("Conversation 上下文投影取用失败", error=str(exc))
        return context

    @staticmethod
    def _memory_visible(
        item,
        *,
        conversation_id: str,
        actor_id: str | None,
        scene_id: str,
        allowed_scopes: set[str],
    ) -> bool:
        if item.recall_scope not in allowed_scopes:
            return False
        if item.recall_scope == "conversation_private":
            return item.conversation_id == conversation_id
        if item.recall_scope == "actor_private":
            return bool(actor_id) and item.actor_id == actor_id
        if item.recall_scope == "space_local":
            return item.scene_id == scene_id
        return True

    @staticmethod
    def _compose(persona_prompt: str, context: dict[str, str]) -> str:
        return f"""{persona_prompt}

===== 会话机制 =====
你正在一个持续在线的长会话中回复，必须承接历史上下文，不要把每一轮都当成第一次见面。

===== 当前会话状态 =====
{context.get('conversation_state') or '无'}

===== 近期原始对话 =====
{context.get('recent_dialogue') or '无'}

===== 相关历史片段 =====
{context.get('historical_segments') or '无'}

===== 长期偏好 =====
{context.get('preference') or '无'}

===== 相关记忆 =====
{context.get('ltm') or '无'}

===== 世界知识 =====
{context.get('knowledge') or '无'}

===== 近期经历 =====
{context.get('experience') or '无'}

===== 用户发送的媒体内容 =====
（以下是对用户发来的图片/表情包/视频的简要描述，请自然地参考，不要逐字复述描述词）
{context.get('multimodal') or '无图片或视频'}
""".strip()
