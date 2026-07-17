"""
agent_plan_use_case.py - LLM 驱动的智能工具规划用例
"""
import asyncio
import json
from dataclasses import dataclass, field
from typing import List

from .base_use_case import BaseUseCase
from glimmer_cradle.cognition.identity.self_entity import SelfEntity
from glimmer_cradle.cognition.inference.gateway import LLMEngine, LLMMessage, LLMRequest
from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.protocol.generated.ipc.agent_plan_payload import SkillToolDescriptor
from glimmer_cradle.cognition.protocol.generated.ipc.agent_plan_result import (
    AgentPlanResult,
    SkillToolSuggestion,
)

logger = get_logger("agent_plan_use_case")

_PLAN_SYSTEM_PROMPT = (
    "你是一个 AI 任务规划助手。根据用户目标和可用工具列表，输出结构化工具调用规划。\n\n"
    "规则：\n"
    "1. 仅从可用工具列表中选择 skill_id 和 tool_name，不要凭空创造\n"
    "2. 每条建议包含 skill_id、tool_name、purpose、confidence(0~1)、arguments_hint(dict)\n"
    "3. 建议数量 1-4 条，按执行优先级排序\n"
    "4. 无合适工具时输出空 suggestions 列表\n"
    '5. 必须输出合法 JSON，格式：'
    '{"reasoning":"...","plan_summary":"...","suggestions":'
    '[{"skill_id":"...","tool_name":"...","purpose":"...","confidence":0.9,"arguments_hint":{}}]}'
)


@dataclass
class AgentPlanInput:
    user_goal: str
    scene_id: str = ""
    available_tools: List[SkillToolDescriptor] = field(default_factory=list)
    trace_id: str = ""


AgentPlanOutput = AgentPlanResult


@dataclass
class AgentPlanUseCase(BaseUseCase[AgentPlanInput, AgentPlanOutput]):
    """Agent 规划用例：LLM 驱动的智能工具规划，执行由 TS 层 / MCP 调度完成。"""

    lifecycle_log_level = "debug"
    self_entity: SelfEntity
    llm_engine: LLMEngine

    async def _execute(self, input_data: AgentPlanInput, trace_id: str) -> AgentPlanOutput:
        goal = input_data.user_goal.strip()

        if input_data.available_tools:
            tools_lines = []
            for t in input_data.available_tools:
                line = f"- skill_id={t.skill_id}，tool_name={t.tool_name}：{t.description}"
                if t.parameters:
                    line += "（参数 Schema：" + json.dumps(t.parameters, ensure_ascii=False) + "）"
                tools_lines.append(line)
            tools_text = "\n".join(tools_lines)
        else:
            tools_text = "（当前没有可执行的 Skill 工具）"

        user_prompt = (
            "【用户目标】\n" + goal
            + "\n\n【可用工具】\n" + tools_text
            + "\n\n请输出规划 JSON。"
        )

        llm_request = LLMRequest(
            messages=[
                LLMMessage(role="system", content=_PLAN_SYSTEM_PROMPT),
                LLMMessage(role="user", content=user_prompt),
            ],
            metadata={
                "purpose": "agent_plan",
                "capture_category": "skill",
                "scene_id": input_data.scene_id,
                "trace_id": input_data.trace_id,
            },
        )

        suggestions: List[SkillToolSuggestion] = []
        reasoning = ""
        summary = ""

        try:
            raw = await asyncio.to_thread(self.llm_engine.generate, llm_request)
            text = raw.strip()
            fence = chr(96) * 3  # ```
            if fence + "json" in text:
                text = text.split(fence + "json", 1)[1].split(fence, 1)[0].strip()
            elif fence in text:
                text = text.split(fence, 1)[1].split(fence, 1)[0].strip()

            parsed = json.loads(text)
            reasoning = parsed.get("reasoning", "")
            summary = parsed.get("plan_summary", "")
            for item in parsed.get("suggestions", []):
                suggestions.append(SkillToolSuggestion.model_validate(item))
            logger.debug("LLM 规划成功", goal_len=len(goal), suggestion_count=len(suggestions))

        except Exception as exc:
            logger.warning("LLM 规划失败，返回空建议", error=str(exc), goal=goal[:60])
            reasoning = "LLM 规划异常：" + str(exc)
            summary = "规划失败，请检查 LLM 服务。"

        if not summary:
            summary = "已为目标生成 " + str(len(suggestions)) + " 条工具建议。"

        return AgentPlanOutput(
            summary=summary,
            reasoning=reasoning,
            suggestions=suggestions,
            trace_id=trace_id,
        )
