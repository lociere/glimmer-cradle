"""Cognition 内部行动规划器。

该模块只负责语义级 ActionPlan 判断，不读取 Skill catalog，也不接触平台 IO。
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal

from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.observability.metrics import counter
from glimmer_cradle.cognition.inference.service import (
    ModelTierEnum,
    ReasoningRequest,
    ReasoningService,
    ReasoningUnavailable,
)

logger = get_logger("cognitive_action_planner")

CognitiveAction = Literal["reply", "skill_request", "ask_clarification", "noop"]

CapabilityKind = Literal[
    "web_navigation",
    "realtime_lookup",
    "desktop_action",
    "clipboard",
    "notification",
    "extension_action",
    "mcp_tool",
    "platform_message",
    "none",
]

VALID_ACTIONS = {"reply", "skill_request", "ask_clarification", "noop"}
VALID_CAPABILITY_KINDS = {
    "web_navigation",
    "realtime_lookup",
    "desktop_action",
    "clipboard",
    "notification",
    "extension_action",
    "mcp_tool",
    "platform_message",
    "none",
}


@dataclass(frozen=True)
class ActionPlan:
    action: CognitiveAction
    original_goal: str
    goal: str
    capability_kind: CapabilityKind
    reason: str
    confidence: float
    planning_hint: str | None = None

    @staticmethod
    def reply(goal: str, reason: str = "无需外部能力") -> "ActionPlan":
        return ActionPlan(
            action="reply",
            original_goal=goal,
            goal=goal,
            capability_kind="none",
            reason=reason,
            confidence=0.0,
        )


class CognitiveActionPlanner:
    """基于结构化推理结果判断本拍行动类型。"""

    def __init__(self, reasoning: ReasoningService | None) -> None:
        self._reasoning = reasoning

    async def plan(
        self,
        *,
        goal: str,
        scene_id: str,
        tier: ModelTierEnum,
        trace_id: str = "",
    ) -> ActionPlan:
        normalized_goal = goal.strip()
        if not normalized_goal:
            return ActionPlan(
                action="noop",
                original_goal="",
                goal="",
                capability_kind="none",
                reason="没有可规划目标",
                confidence=0.0,
            )
        if self._reasoning is None:
            return ActionPlan.reply(normalized_goal, "推理服务不可用，降级为普通回复路径")

        req = ReasoningRequest(
            system=(
                "你是微光摇篮 Cognition 内部行动规划器，只做结构化行动判断，不扮演角色，"
                "也不生成给用户看的回复。\n"
                "判断当前用户目标是否需要 Host-Owned Skill Plane 的外部能力。\n"
                "外部能力包括：打开或操作网页/桌面、查询实时或外部世界信息、读写剪贴板、"
                "发通知、调用扩展动作、调用 MCP 工具、向平台发送受控消息。\n"
                "不要因为出现站点名、软件名或概念名就判定需要工具；解释概念、询问是什么、"
                "用户明确要求不要执行而只要说明步骤、普通闲聊或角色互动，都应 action=reply。\n"
                "只输出 JSON，不要输出 markdown。Schema："
                "{\"action\":\"reply|skill_request|ask_clarification|noop\","
                "\"original_goal\":\"原始目标\","
                "\"goal\":\"整理后的行动目标\","
                "\"capability_kind\":\"web_navigation|realtime_lookup|desktop_action|clipboard|notification|extension_action|mcp_tool|platform_message|none\","
                "\"reason\":\"简短原因\","
                "\"confidence\":0到1之间数字,"
                "\"planning_hint\":\"可选，给 Kernel 规划用的提示\"}"
            ),
            user=normalized_goal,
            metadata={
                "purpose": "cognitive_action_plan",
                "capture_category": "decision",
                "scene_id": scene_id,
                "trace_id": trace_id,
            },
            temperature=0.0,
        )
        try:
            resp = await self._reasoning.request(req, tier=tier)
        except ReasoningUnavailable as error:
            logger.debug("ActionPlan 推理不可用，降级为普通回复路径", error=str(error))
            return ActionPlan.reply(normalized_goal, "推理服务不可用，未触发 Skill")
        except Exception as error:
            logger.debug("ActionPlan 推理异常，降级为普通回复路径", error=str(error))
            counter("cognition.action_plan_error", 1)
            return ActionPlan.reply(normalized_goal, "行动规划失败，未触发 Skill")

        plan = self._parse_plan(resp.text, fallback_goal=normalized_goal)
        if plan is None:
            counter("cognition.action_plan_invalid", 1)
            return ActionPlan.reply(normalized_goal, "行动规划结果非法，未触发 Skill")
        return plan

    @staticmethod
    def _parse_plan(text: str, *, fallback_goal: str) -> ActionPlan | None:
        raw = (text or "").strip()
        if not raw:
            return None
        fence = chr(96) * 3
        if fence + "json" in raw:
            raw = raw.split(fence + "json", 1)[1].split(fence, 1)[0].strip()
        elif fence in raw:
            raw = raw.split(fence, 1)[1].split(fence, 1)[0].strip()
        try:
            parsed = json.loads(raw)
        except Exception:
            return None
        if not isinstance(parsed, dict):
            return None

        action = parsed.get("action")
        if action not in VALID_ACTIONS:
            return None
        capability_kind = parsed.get("capability_kind")
        if capability_kind not in VALID_CAPABILITY_KINDS:
            capability_kind = "none"
        confidence_raw = parsed.get("confidence", 0.0)
        try:
            confidence = float(confidence_raw)
        except (TypeError, ValueError):
            confidence = 0.0
        confidence = min(1.0, max(0.0, confidence))
        original_goal = parsed.get("original_goal")
        goal = parsed.get("goal")
        reason = parsed.get("reason")
        planning_hint = parsed.get("planning_hint")
        return ActionPlan(
            action=action,
            original_goal=original_goal.strip() if isinstance(original_goal, str) and original_goal.strip() else fallback_goal,
            goal=goal.strip() if isinstance(goal, str) and goal.strip() else fallback_goal,
            capability_kind=capability_kind,
            reason=reason.strip() if isinstance(reason, str) and reason.strip() else "行动规划未提供原因",
            confidence=confidence,
            planning_hint=planning_hint.strip() if isinstance(planning_hint, str) and planning_hint.strip() else None,
        )
