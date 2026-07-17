"""角色回复所需上下文的受控装配。"""

from __future__ import annotations

from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.context.sources.base import allowed_recall_scopes

logger = get_logger("reply_context")

_EMOTION_HINTS: dict[str, str] = {
    "calm": "平静",
    "happy": "开心",
    "shy": "害羞",
    "angry": "生气",
    "sulky": "委屈",
    "curious": "好奇",
    "sad": "难过",
}


class ReplyContextBuilder:
    """按 token 预算前的固定分区收集会话、记忆、知识和经历。"""

    def __init__(self, *, self_entity=None, conversation=None,
                 recent_experience_source=None) -> None:
        self._entity = self_entity
        self._conversation = conversation
        self._experience = recent_experience_source

    async def build(
        self,
        *,
        persona_prompt: str,
        scene_id: str,
        conversation_id: str,
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
            actor_id=actor_id,
            recall_scope=recall_scope,
            user_text=user_text,
            emotion_state=emotion_state,
            trace_id=trace_id,
        )
        context["multimodal"] = multimodal_text
        return self._compose(persona_prompt, context)

    async def _gather(
        self, *, scene_id: str, conversation_id: str, actor_id: str | None,
        recall_scope: str, user_text: str, emotion_state: dict, trace_id: str
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

        try:
            preferences = [
                item for item in self._entity.memory.all_current()
                if item.attributes.get("preference") and self._memory_visible(
                    item, conversation_id=conversation_id, actor_id=actor_id,
                    scene_id=scene_id, allowed_scopes=self._allowed_scopes(recall_scope),
                )
            ]
            context["preference"] = "\n".join(f"偏好：{item.content}" for item in preferences)
        except Exception as exc:
            logger.debug("偏好记忆取用失败", error=str(exc))
        try:
            memories = await self._entity.memory.retrieve(
                query, actor_id=actor_id, scene_id=scene_id,
                conversation_id=conversation_id,
                allowed_scopes=self._allowed_scopes(recall_scope), limit=6,
            )
            context["ltm"] = "\n".join(f"记忆：{item.content}" for item in memories)
        except Exception as exc:
            logger.debug("相关记忆检索失败", error=str(exc))
        try:
            knowledge = await self._entity.knowledge_base.get_knowledge(query=query)
            context["knowledge"] = "\n".join(f"知识：{item.content}" for item in knowledge)
        except Exception as exc:
            logger.debug("世界知识取用失败", error=str(exc))
        if self._experience is not None:
            try:
                context["experience"] = self._experience.digest(
                    query,
                    scene_id=scene_id,
                    conversation_id=conversation_id,
                    actor_id=actor_id,
                    allowed_scopes=allowed_recall_scopes(recall_scope),
                    current_trace_id=trace_id,
                    max_items=6,
                )
            except Exception as exc:
                logger.debug("近期经历取用失败", error=str(exc))
        try:
            if self._conversation is not None:
                (
                    context["conversation_state"],
                    context["recent_dialogue"],
                    context["historical_segments"],
                ) = await self._conversation.prompt_context(
                    conversation_id, query,
                    allowed_scopes=self._allowed_scopes(recall_scope),
                )
        except Exception as exc:
            logger.debug("Conversation 上下文投影取用失败", error=str(exc))
        return context

    @staticmethod
    def _allowed_scopes(recall_scope: str) -> set[str]:
        return allowed_recall_scopes(recall_scope)

    @staticmethod
    def _memory_visible(item, *, conversation_id: str, actor_id: str | None,
                        scene_id: str, allowed_scopes: set[str]) -> bool:
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
