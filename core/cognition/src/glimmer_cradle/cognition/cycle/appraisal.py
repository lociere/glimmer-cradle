"""感知评价、情绪更新与感知经历记录。"""

from __future__ import annotations

import asyncio

from glimmer_cradle.cognition.cycle.turn import CycleTurn, UserConversationTurn
from glimmer_cradle.cognition.cycle.workspace import WorkspaceItem
from glimmer_cradle.cognition.experience.events import MomentKind, SourceDescriptor
from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.observability.metrics import gauge

logger = get_logger("perception_appraisal")


class PerceptionAppraiser:
    """将本拍感知统一解释为多模态路由、情绪变化和 Moment。"""

    def __init__(self, *, recorder, emotion_system=None, multimodal_router=None,
                 self_entity=None) -> None:
        self._recorder = recorder
        self._emotion = emotion_system
        self._router = multimodal_router
        self._entity = self_entity

    async def appraise(
        self, sense_results: list[list[WorkspaceItem]], turn: CycleTurn
    ) -> None:
        perceptions = [
            item
            for items in sense_results
            for item in items
            if item.source == "perception" and isinstance(item.content, dict)
        ]
        if not perceptions:
            return

        emotion_inputs: list[str] = []
        for item in perceptions:
            content = item.content
            trace_id = content.get("trace_id", "")
            scene_id = content.get("scene_id", "")
            conversation_id = content.get("conversation_id", "")
            continuity_id = content.get("continuity_id", "")
            thread_id = content.get("thread_id", "main")
            recall_scope = content.get("recall_scope", "conversation_private")
            disclosure_scope = content.get("disclosure_scope", "conversation_private")
            text, semantic_text, vision, provider_key = await self._route(content)
            if trace_id:
                turn.routes[trace_id] = {
                    "user_text": text,
                    "multimodal_text": semantic_text,
                    "vision": vision,
                    "provider_key": provider_key,
                }
            emotion_input = "\n".join(
                part for part in [text, semantic_text] if part
            ).strip()
            if emotion_input:
                emotion_inputs.append(emotion_input)
            turn.scene_id = scene_id or turn.scene_id
            turn.conversation_id = conversation_id or turn.conversation_id
            turn.continuity_id = continuity_id or turn.continuity_id
            turn.thread_id = thread_id or turn.thread_id
            turn.recall_scope = recall_scope or turn.recall_scope
            turn.disclosure_scope = disclosure_scope or turn.disclosure_scope
            turn.trace_id = trace_id or turn.trace_id
            response_policy = content.get("response_policy", "reply_allowed")
            if not isinstance(response_policy, str):
                response_policy = "reply_allowed"
            turn.response_policies.append(response_policy)
            moment = self._recorder.record(
                MomentKind.PERCEPTION,
                content={
                    "text": text,
                    "address_mode": content.get("address_mode", "direct"),
                    "response_policy": response_policy,
                    "familiarity": content.get("familiarity", 0),
                    "has_multimodal": bool(semantic_text or vision),
                    "actor_id": content.get("actor_id"),
                    "actor_name": content.get("actor_name"),
                },
                scene_id=scene_id or None,
                conversation_id=conversation_id,
                continuity_id=continuity_id,
                thread_id=thread_id,
                interaction_id=str(content.get("interaction_id") or trace_id or ""),
                actor_id=content.get("actor_id"),
                actor_name=content.get("actor_name"),
                origin=(
                    SourceDescriptor(**content["origin"])
                    if isinstance(content.get("origin"), dict)
                    else None
                ),
                retention_ceiling=str(content.get("retention_ceiling") or "experience"),
                recall_scope=recall_scope,
                disclosure_scope=disclosure_scope,
                trace_id=trace_id or None,
                importance=0.5,
            )
            if moment is not None:
                turn.perception_moment_ids.append(moment.moment_id)
                content["experience_moment_id"] = moment.moment_id
            if text and text.strip():
                turn.user_turns.append(UserConversationTurn(
                    scene_id=scene_id,
                    conversation_id=conversation_id,
                    continuity_id=continuity_id,
                    thread_id=thread_id,
                    recall_scope=recall_scope,
                    disclosure_scope=disclosure_scope,
                    text=text,
                    familiarity=int(content.get("familiarity", 0) or 0),
                    moment_id=moment.moment_id if moment is not None else None,
                    interaction_id=str(content.get("interaction_id") or trace_id or "") or None,
                    actor_id=content.get("actor_id"),
                    actor_name=content.get("actor_name"),
                    retention_ceiling=str(content.get("retention_ceiling") or "experience"),
                ))

        self._update_emotion(emotion_inputs, turn)

    async def _route(self, content: dict) -> tuple[str, str, tuple, str | None]:
        text = content.get("text", "")
        text = text if isinstance(text, str) else ""
        model_input = content.get("model_input")
        if self._router is None or not model_input:
            return text, "", (), None
        try:
            route = await asyncio.to_thread(self._router.route, model_input)
        except Exception as exc:
            logger.warning("多模态路由失败，回落纯文本", error=str(exc))
            return text, "", (), None
        effective_text = route.primary_text or "[多模态输入]"
        semantic_text = route.semantic_text or ""
        vision = tuple(
            (message.prompt, message.uri, message.mime_type)
            for message in route.vision_messages
        )
        provider_key = None
        if vision and self._entity is not None:
            try:
                provider_key = self._entity.inference_config.multimodal.core_model
            except Exception:
                provider_key = None
        return effective_text, semantic_text, vision, provider_key

    def _update_emotion(self, inputs: list[str], turn: CycleTurn) -> None:
        if self._emotion is None or not inputs:
            return
        try:
            self._emotion.update_by_input("\n".join(inputs).strip())
            state = self._emotion.get_state()
        except Exception as exc:
            logger.warning("感知情绪评价失败（已隔离）", error=str(exc))
            return
        if not isinstance(state, dict):
            return
        gauge(
            "emotion.intensity",
            float(state.get("intensity", 0.0)),
            labels={"emotion": str(state.get("emotion_type", ""))},
        )
        moment = self._recorder.record(
            MomentKind.EMOTION,
            content={"emotion": state},
            scene_id=turn.scene_id or None,
            conversation_id=turn.conversation_id,
            continuity_id=turn.continuity_id,
            thread_id=turn.thread_id,
            recall_scope=turn.recall_scope,
            disclosure_scope=turn.disclosure_scope,
            trace_id=turn.trace_id or None,
            causation_ids=tuple(turn.perception_moment_ids),
            importance=0.4,
        )
        if moment is not None:
            turn.emotion_moment_id = moment.moment_id
