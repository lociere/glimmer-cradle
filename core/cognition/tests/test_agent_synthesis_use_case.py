from pathlib import Path

import pytest

from glimmer_cradle.cognition_worker.composition import AgentSynthesisUseCase
from glimmer_cradle.cognition.ports.kernel.models import AgentSynthesisInput
from tests.conftest import CLOCK, IDS, OBSERVABILITY, build_experience_recorder
from glimmer_cradle.conversation import (
    ConversationTurn,
    SqliteTurnStore,
    TurnController,
)
from glimmer_cradle.conversation.log import MomentKind


class _FakePersonaCompiler:
    def build_persona_prompt(self, emotion_state: dict, address_mode: str = "direct") -> str:
        return (
            "你是月见（Selrena）。\n"
            "[表达倾向]\n用自然、带一点迟疑的中文回应。\n"
            "[对话策略]\n保持角色语气，不输出内部规则。"
        )


class _FakeLlmEngine:
    def __init__(self, text: str = "我这里没能确认成功，但可以把结果先告诉你。") -> None:
        self.text = text
        self.requests = []

    def generate(self, request):
        self.requests.append(request)
        return self.text


@pytest.mark.asyncio
async def test_agent_synthesis_uses_persona_prompt_for_system_message() -> None:
    llm = _FakeLlmEngine()
    use_case = AgentSynthesisUseCase(
        nickname="月见",
        llm_engine=llm,
        persona_compiler=_FakePersonaCompiler(),
        ids=IDS,
        observability=OBSERVABILITY,
    )

    output = await use_case.execute(AgentSynthesisInput(
        original_goal="查一下今天上海天气",
        tool_results=[{
            "tool_name": "weather.lookup",
            "status": "succeeded",
            "result_json": '{"city":"上海","weather":"多云"}',
        }],
    ), trace_id="trace-synthesis")

    assert output.reply_content == "我这里没能确认成功，但可以把结果先告诉你。"
    assert len(llm.requests) == 1
    system_prompt = llm.requests[0].messages[0].content
    assert "你是月见（Selrena）。" in system_prompt
    assert "[表达倾向]" in system_prompt
    assert "[对话策略]" in system_prompt
    assert "[外部能力结果处理]" in system_prompt
    assert "不可信观察" in system_prompt
    assert "情绪标签" not in system_prompt


@pytest.mark.asyncio
async def test_agent_synthesis_error_result_prompt_does_not_pretend_success() -> None:
    llm = _FakeLlmEngine("这次外部结果没有成功返回，我不能假装已经完成。")
    use_case = AgentSynthesisUseCase(
        nickname="月见",
        llm_engine=llm,
        persona_compiler=_FakePersonaCompiler(),
        ids=IDS,
        observability=OBSERVABILITY,
    )

    output = await use_case.execute(AgentSynthesisInput(
        original_goal="打开 B 站",
        tool_results=[{
            "tool_name": "browser.open",
            "status": "error",
            "result_json": '{"message":"permission denied"}',
        }],
    ), trace_id="trace-synthesis-error")

    assert "不能假装" in output.reply_content
    user_prompt = llm.requests[0].messages[1].content
    assert "[error] browser.open" in user_prompt
    assert "permission denied" in user_prompt
    assert "如果外部结果出错、不足或互相矛盾，要坦然说明" in llm.requests[0].messages[0].content


@pytest.mark.asyncio
async def test_agent_synthesis_records_tool_result_with_source(tmp_path: Path) -> None:
    recorder = build_experience_recorder(tmp_path / "experience")
    await recorder.start()
    turn_controller = TurnController(
        SqliteTurnStore(tmp_path / "turns.db"), clock=CLOCK
    )
    await turn_controller.connect()
    accepted_turn = await turn_controller.accept(ConversationTurn(
        turn_id="trace-tool",
        scene_id="desktop",
        conversation_id="conversation-1",
        continuity_id="continuity-1",
        thread_id="main",
        payload_digest="sha256:trace-tool",
    ))
    await turn_controller.start(
        accepted_turn.turn_id, expected_revision=accepted_turn.revision
    )
    request = recorder.record(
        MomentKind.ACTION,
        {"action_type": "skill_request", "operation_id": "action:trace-tool"},
        scene_id="desktop",
        conversation_id="conversation-1",
        thread_id="main",
        interaction_id="trace-tool",
        trace_id="trace-tool",
    )
    use_case = AgentSynthesisUseCase(
        nickname="月见",
        llm_engine=_FakeLlmEngine("已经打开。"),
        persona_compiler=_FakePersonaCompiler(),
        ids=IDS,
        observability=OBSERVABILITY,
        experience_recorder=recorder,
        turn_controller=turn_controller,
    )

    synthesis_input = AgentSynthesisInput(
        original_goal="打开 B 站",
        scene_id="desktop",
        trace_id="trace-tool",
        conversation={"conversation_id": "conversation-1", "thread_id": "main"},
        tool_results=[{
            "skill_id": "browser",
            "tool_name": "browser.open",
            "status": "success",
            "result_json": '{"url":"https://www.bilibili.com"}',
            "arguments_json": '{"url":"https://www.bilibili.com"}',
            "invocation_id": "invocation-1",
            "provider_kind": "extension",
            "provider_id": "browser-extension",
            "provider_version": "1.0.0",
            "source_event_id": "event-1",
            "schema_ref": "glimmer://browser/open-result/v1",
        }],
    )
    first_output = await use_case.execute(synthesis_input, trace_id="trace-tool")
    await recorder.flush()

    tool_call = next(
        moment for moment in recorder.log.query()
        if moment.kind == MomentKind.ACTION.value
        and moment.content.get("action_type") == "tool_call"
    )
    assert request is not None
    assert tool_call.causation_ids == (request.moment_id,)
    assert tool_call.content["skill_id"] == "browser"
    assert tool_call.content["arguments_json"] == '{"url":"https://www.bilibili.com"}'
    assert tool_call.origin.schema_ref == "glimmer://capability/tool-call/v1"
    action_result = next(
        moment for moment in recorder.log.query()
        if moment.kind == MomentKind.ACTION_RESULT.value
    )
    assert action_result.trace_id == "trace-tool"
    assert action_result.origin.provider_id == "browser-extension"
    assert action_result.origin.schema_ref == "glimmer://browser/open-result/v1"
    assert action_result.retention_ceiling == "memory_candidate"
    assert action_result.causation_ids == (tool_call.moment_id,)
    reply = next(
        moment for moment in recorder.log.query()
        if moment.kind == MomentKind.REPLY.value
    )
    assert reply.content == {"text": "已经打开。", "length": 5}
    assert reply.trace_id == "trace-tool"
    assert reply.interaction_id == "trace-tool"
    assert reply.causation_ids == (action_result.moment_id,)
    positions = [tool_call.seq, action_result.seq, reply.seq]
    assert positions == sorted(positions)
    completed_turn = await turn_controller.load("trace-tool")
    assert completed_turn is not None and completed_turn.status == "completed"

    replay_output = await use_case.execute(synthesis_input, trace_id="trace-tool")
    await recorder.flush()
    assert replay_output.reply_content == first_output.reply_content
    assert len(recorder.log.query()) == 4
    await turn_controller.close()
    await recorder.stop()
