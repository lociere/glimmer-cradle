import json

import pytest

from glimmer_cradle.cognition.application.agent_plan_use_case import AgentPlanInput, AgentPlanUseCase
from glimmer_cradle.cognition.protocol.generated.ipc.agent_plan_payload import SkillToolDescriptor


class _PlanningLLM:
    def __init__(self) -> None:
        self.requests = []

    def generate(self, request):
        self.requests.append(request)
        return json.dumps({
            "reasoning": "需要读取当前配置。",
            "plan_summary": "读取配置",
            "suggestions": [{
                "skill_id": "core.settings",
                "tool_name": "read",
                "purpose": "读取配置状态",
                "confidence": 0.9,
                "arguments_hint": {"scope": "self"},
            }],
        })


@pytest.mark.asyncio
async def test_agent_plan_keeps_kernel_skill_identity_in_suggestion():
    llm = _PlanningLLM()
    use_case = AgentPlanUseCase(self_entity=object(), llm_engine=llm)

    result = await use_case.execute(AgentPlanInput(
        user_goal="检查当前配置",
        trace_id="trace-agent-plan",
        available_tools=[SkillToolDescriptor(
            skill_id="core.settings",
            tool_name="read",
            description="读取配置状态",
            parameters={"type": "object"},
        )],
    ), "trace-agent-plan")

    assert result.suggestions[0].skill_id == "core.settings"
    assert result.suggestions[0].tool_name == "read"
    assert result.suggestions[0].arguments_hint == {"scope": "self"}
    prompt = llm.requests[0].messages[1].content
    assert "skill_id=core.settings" in prompt
    assert "tool_name=read" in prompt
