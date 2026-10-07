"""Cognition semantic planning controller.

This boundary decides what kind of action a goal requires. It neither reads the
Skill catalog nor performs platform IO.
"""

from __future__ import annotations

import json
from typing import cast

from glimmer_cradle.cognition.inference import (
    InferenceController,
    InferenceRequest,
    InferenceUnavailable,
    ModelTier,
)
from glimmer_cradle.cognition.planning.commitment import Commitment
from glimmer_cradle.cognition.planning.goal import Goal
from glimmer_cradle.cognition.planning.plan import (
    VALID_ACTIONS,
    VALID_CAPABILITY_KINDS,
    ActionPlan,
    CapabilityKind,
    PlanVersion,
)
from glimmer_cradle.cognition.planning.planning_store import PlanningStore
from glimmer_cradle.cognition.ports import JobPort, ObservabilityPort


class PlanningController:
    """Produce and optionally journal one semantic plan for a normalized goal."""

    def __init__(
        self,
        reasoning: InferenceController | None,
        *,
        observability: ObservabilityPort,
        store: PlanningStore | None = None,
    ) -> None:
        self._reasoning = reasoning
        self._store = store
        self._observability = observability
        self._logger = observability.logger("planning_controller")

    async def accept_commitment(
        self, commitment_id: str, plan: PlanVersion, *, due_at: int
    ) -> Commitment:
        """显式接受语义；普通 ActionPlan 不自动升级为长期承诺。"""
        if self._store is None:
            raise RuntimeError("长期承诺没有持久 Planning owner")
        return await self._store.accept_commitment(commitment_id, plan, due_at=due_at)

    async def deliver_jobs(self, jobs: JobPort, *, limit: int = 64) -> int:
        """先获得实际 Jobs 持久接纳再 ACK；不跨 await 持有 Planning 事务。"""
        if self._store is None:
            raise RuntimeError("长期承诺没有持久 Planning owner")
        delivered = 0
        for request in await self._store.pending_job_requests(limit=limit):
            receipt = await jobs.request(request)
            await self._store.acknowledge_job_request(request, receipt)
            delivered += 1
        return delivered

    async def plan(
        self,
        *,
        goal: str,
        scene_id: str,
        tier: ModelTier,
        trace_id: str = "",
    ) -> ActionPlan:
        normalized = Goal.normalize(goal, scene_id=scene_id, trace_id=trace_id)
        if not normalized.text:
            return await self._finish(
                normalized,
                ActionPlan(
                    action="noop",
                    original_goal="",
                    goal="",
                    capability_kind="none",
                    reason="没有可规划目标",
                    confidence=0.0,
                ),
            )
        if self._reasoning is None:
            return await self._finish(
                normalized,
                ActionPlan.reply(normalized.text, "推理服务不可用，降级为普通回复路径"),
            )

        request = InferenceRequest(
            system=(
                "你是微光摇篮 Cognition 内部行动规划器，只做结构化行动判断，不扮演角色，"
                "也不生成给用户看的回复。\n"
                "判断当前用户目标是否需要 Host-Owned Skill Plane 的外部能力。\n"
                "外部能力包括：打开或操作网页/桌面、查询实时或外部世界信息、读写剪贴板、"
                "发通知、调用扩展动作、调用 MCP 工具、向平台发送受控消息。\n"
                "不要因为出现站点名、软件名或概念名就判定需要工具；解释概念、询问是什么、"
                "用户明确要求不要执行而只要说明步骤、普通闲聊或角色互动，都应 action=reply。\n"
                "只输出 JSON，不要输出 markdown。Schema："
                '{"action":"reply|skill_request|ask_clarification|noop",'
                '"original_goal":"原始目标","goal":"整理后的行动目标",'
                '"capability_kind":"web_navigation|realtime_lookup|desktop_action|clipboard|notification|extension_action|mcp_tool|platform_message|none",'
                '"reason":"简短原因","confidence":0到1之间数字,'
                '"planning_hint":"可选，给 Kernel 规划用的提示"}'
            ),
            user=normalized.text,
            metadata={
                "purpose": "cognitive_action_plan",
                "capture_category": "decision",
                "scene_id": normalized.scene_id,
                "trace_id": normalized.trace_id,
            },
            temperature=0.0,
        )
        try:
            response = await self._reasoning.request(request, tier=tier)
        except InferenceUnavailable as error:
            self._logger.debug(
                "ActionPlan 推理不可用，降级为普通回复路径", error=str(error)
            )
            return await self._finish(
                normalized,
                ActionPlan.reply(normalized.text, "推理服务不可用，未触发 Skill"),
            )
        except Exception as error:
            self._logger.debug(
                "ActionPlan 推理异常，降级为普通回复路径", error=str(error)
            )
            self._observability.counter("cognition.action_plan_error", 1)
            return await self._finish(
                normalized,
                ActionPlan.reply(normalized.text, "行动规划失败，未触发 Skill"),
            )

        plan = self._parse_plan(response.text, fallback_goal=normalized.text)
        if plan is None:
            self._observability.counter("cognition.action_plan_invalid", 1)
            plan = ActionPlan.reply(normalized.text, "行动规划结果非法，未触发 Skill")
        return await self._finish(normalized, plan)

    async def _finish(self, goal: Goal, plan: ActionPlan) -> ActionPlan:
        if self._store is not None:
            await self._store.record(goal, plan)
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
        try:
            confidence = float(parsed.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0
        original_goal = parsed.get("original_goal")
        planned_goal = parsed.get("goal")
        reason = parsed.get("reason")
        planning_hint = parsed.get("planning_hint")
        return ActionPlan(
            action=action,
            original_goal=(
                original_goal.strip()
                if isinstance(original_goal, str) and original_goal.strip()
                else fallback_goal
            ),
            goal=(
                planned_goal.strip()
                if isinstance(planned_goal, str) and planned_goal.strip()
                else fallback_goal
            ),
            capability_kind=cast(CapabilityKind, capability_kind),
            reason=(
                reason.strip()
                if isinstance(reason, str) and reason.strip()
                else "行动规划未提供原因"
            ),
            confidence=min(1.0, max(0.0, confidence)),
            planning_hint=(
                planning_hint.strip()
                if isinstance(planning_hint, str) and planning_hint.strip()
                else None
            ),
        )
