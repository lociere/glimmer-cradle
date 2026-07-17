"""结构化行动规划与角色回复推理。"""

from __future__ import annotations

from collections.abc import Callable

from glimmer_cradle.cognition.cycle.action_planner import ActionPlan, CognitiveActionPlanner
from glimmer_cradle.cognition.cycle.reply_context import ReplyContextBuilder
from glimmer_cradle.cognition.cycle.turn import CycleTurn
from glimmer_cradle.cognition.cycle.workspace import WorkspaceItem
from glimmer_cradle.cognition.inference.service import (
    ModelTierEnum,
    ReasoningRequest,
    ReasoningService,
    ReasoningUnavailable,
)
from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.observability.metrics import counter

logger = get_logger("cognition_deliberation")


class DeliberationController:
    """先生成 ActionPlan，再按计划决定回复、能力请求、澄清或沉默。"""

    def __init__(
        self,
        *,
        reasoning: ReasoningService | None,
        context_builder: ReplyContextBuilder,
        activity_controller=None,
        emotion_system=None,
        persona_injector=None,
        boundary_validator: Callable[[str], bool] | None = None,
    ) -> None:
        self._reasoning = reasoning
        self._planner = CognitiveActionPlanner(reasoning)
        self._context = context_builder
        self._activity = activity_controller
        self._emotion = emotion_system
        self._persona = persona_injector
        self._boundary_validator = boundary_validator

    async def deliberate(
        self, broadcast: WorkspaceItem | None, turn: CycleTurn
    ) -> str | None:
        if self._reasoning is None or broadcast is None or broadcast.source != "perception":
            return None
        content = broadcast.content if isinstance(broadcast.content, dict) else {}
        if content.get("response_policy", "reply_allowed") == "observe_only":
            return None
        route = turn.routes.get(content.get("trace_id", ""), {})
        raw_text = content.get("text", "")
        user_text = route.get("user_text") or (
            raw_text if isinstance(raw_text, str) else ""
        )
        vision = route.get("vision", ())
        provider_key = route.get("provider_key")
        multimodal_text = route.get("multimodal_text", "")
        if (not user_text or not user_text.strip()) and not vision:
            return None

        plan = await self._plan(content, user_text, multimodal_text)
        if plan is not None:
            turn.action_plan = plan
            planned_reply = self._apply_plan(plan, turn)
            if plan.action == "skill_request" and turn.skill_request is not None:
                return None
            if plan.action in {"noop", "ask_clarification"}:
                return planned_reply

        request = ReasoningRequest(
            system=await self._build_system_prompt(content, turn, multimodal_text),
            user=user_text,
            vision=vision,
            provider_key=provider_key,
            metadata={
                "purpose": "reply",
                "capture_category": "response",
                "scene_id": content.get("scene_id", ""),
                "trace_id": content.get("trace_id", ""),
            },
        )
        try:
            response = await self._reasoning.request(request, tier=self._reasoning_tier())
        except ReasoningUnavailable as exc:
            logger.debug("回复推理不可用，本拍不回复", error=str(exc))
            return None
        except Exception as exc:
            logger.error("回复推理异常", error=str(exc), exc_info=True)
            counter("cognition.deliberate_error", 1)
            return None
        reply = (response.text or "").strip()
        if not reply or not self._within_boundary(reply):
            return None
        return reply

    async def _plan(
        self, content: dict, user_text: str, multimodal_text: str
    ) -> ActionPlan | None:
        goal = "\n".join(
            part for part in [user_text, multimodal_text] if part
        ).strip()
        if not goal:
            return None
        return await self._planner.plan(
            goal=goal,
            scene_id=content.get("scene_id", ""),
            tier=self._reasoning_tier(),
            trace_id=content.get("trace_id", ""),
        )

    def _apply_plan(self, plan: ActionPlan, turn: CycleTurn) -> str | None:
        if plan.action == "skill_request":
            if plan.confidence >= 0.6 and plan.capability_kind != "none":
                turn.skill_request = {
                    "original_goal": plan.original_goal,
                    "reason": plan.reason,
                    "capability_kind": plan.capability_kind,
                    "confidence": plan.confidence,
                    "planning_hint": plan.planning_hint,
                }
            return None
        if plan.action == "noop":
            return None
        if plan.action != "ask_clarification":
            return None
        prompt = (plan.planning_hint or plan.reason or "").strip()
        if not prompt:
            prompt = "我需要再确认一下你的意思"
        if prompt.endswith(("?", "？")):
            return prompt
        return f"我想先确认一下：{prompt}"

    async def _build_system_prompt(
        self, content: dict, turn: CycleTurn, multimodal_text: str
    ) -> str:
        emotion_state: dict = {}
        if self._emotion is not None:
            try:
                emotion_state = self._emotion.get_state() or {}
            except Exception:
                emotion_state = {}
        persona_prompt = "你是当前角色。用简短、自然的中文回应。"
        if self._persona is not None:
            try:
                persona_prompt = self._persona.build_persona_prompt(
                    emotion_state=emotion_state,
                    address_mode=content.get("address_mode", "direct"),
                )
            except Exception as exc:
                logger.warning("角色 prompt 构建失败，使用最小 prompt", error=str(exc))
        user_text = content.get("text", "")
        return await self._context.build(
            persona_prompt=persona_prompt,
            scene_id=content.get("scene_id", ""),
            conversation_id=content.get("conversation_id", ""),
            actor_id=content.get("actor_id"),
            recall_scope=content.get("recall_scope", "conversation_private"),
            user_text=user_text if isinstance(user_text, str) else "",
            emotion_state=emotion_state,
            trace_id=turn.trace_id,
            multimodal_text=multimodal_text,
        )

    def _reasoning_tier(self) -> ModelTierEnum:
        if self._activity is not None:
            try:
                tier = self._activity.get_state().get("policy", {}).get("model_tier")
                if tier:
                    return ModelTierEnum(tier)
            except Exception:
                pass
        return ModelTierEnum.LOCAL_ONLY

    def _within_boundary(self, reply: str) -> bool:
        if self._boundary_validator is None:
            return True
        try:
            allowed = self._boundary_validator(reply)
        except Exception as exc:
            logger.error("角色边界校验异常，本拍不回复", error=str(exc), exc_info=True)
            counter("cognition.deliberate_boundary_error", 1)
            return False
        if not allowed:
            logger.warning("回复越过角色边界，已拦截")
            counter("cognition.deliberate_boundary_block", 1)
        return allowed
