import asyncio
import hashlib
import json
import time
from pathlib import Path

import grpc
import pytest
from conftest import (
    DeterministicIds,
    FixedClock,
    NullObservability,
    build_test_recorder,
)
from glimmer.cognition.v1 import cognition_service_pb2 as cognition_pb
from glimmer.common.v1 import service_contract_pb2 as common_pb
from glimmer.content.v1 import content_pb2 as content_pb
from glimmer.jobs.v1 import jobs_pb2 as jobs_pb
from glimmer.kernel.v1 import kernel_control_service_pb2 as kernel_pb
from glimmer_cradle.cognition.adapters.persistence import (
    ConsolidationJobRepository,
    EpisodeProjection,
    MemoryRepository,
    SqliteMemoryStore,
)
from glimmer_cradle.cognition.attention import (
    AttentionController as _AttentionController,
)
from glimmer_cradle.cognition.inference import (
    InferenceRequest,
    InferenceSettings,
    LifeClockSettings,
    ModelEventKind,
    ModelSettings,
    MultimodalSettings,
)
from glimmer_cradle.cognition.loop import LoopController as _CycleController
from glimmer_cradle.cognition.loop import PerceptionProvider as _PerceptionProvider
from glimmer_cradle.cognition.loop import WillingnessConfig
from glimmer_cradle.cognition.memory import ConsolidationCoordinator, MemoryController
from glimmer_cradle.cognition.perception import (
    ObservationQueue,
    PerceptionOperationRegistry,
)
from glimmer_cradle.cognition.ports import (
    AgentPlanInput,
    AgentPlanResult,
    AgentSynthesisInput,
    AgentSynthesisOutput,
    CapabilityInvocation,
    ContentReference,
    ConversationHistoryEntry,
    ConversationHistoryResult,
    JobRequest,
    SkillToolDescriptor,
    SkillToolSuggestion,
)
from glimmer_cradle.cognition_worker.adapters import (
    CapabilityClient,
    ContentClient,
    FileAssetReader,
    JobClient,
    ModelClient,
)
from glimmer_cradle.cognition_worker.adapters.model_client import (
    InferenceException,
    LLMEngine,
    LLMSettings,
    ModelMessage,
    ModelRequest,
    MultimodalRouter,
)
from glimmer_cradle.cognition_worker.composition import (
    AgentPlanUseCase,
    AgentSynthesisUseCase,
)
from glimmer_cradle.cognition_worker.rpc_service import (
    CognitionGrpcHost,
    KernelGrpcClient,
    KernelServiceError,
)
from glimmer_cradle.conversation import (
    ConversationTurn,
    SqliteTurnStore,
    TurnController,
)
from glimmer_cradle.conversation.log import MomentKind


async def test_service_maps_knowledge_plan_synthesis_and_history(service) -> None:
    from google.protobuf.json_format import MessageToDict, ParseDict

    host, channel, _queue, _stopped = service

    class Inbound(_Inbound):
        async def on_knowledge_init(self, knowledge):
            assert knowledge.version == "v1"
            assert knowledge.retrieval.top_k == 5
            assert knowledge.entries[0].content == "fact"

        async def on_agent_plan(self, value):
            assert value.trace_id == "plan-trace"
            assert value.available_tools[0].parameters == {"type": "object"}
            return AgentPlanResult(
                summary="summary", reasoning="reason", trace_id=value.trace_id,
                suggestions=[SkillToolSuggestion(
                    skill_id="weather", tool_name="lookup", purpose="weather",
                    confidence=0.8, arguments_hint={"city": "Shanghai"},
                )],
            )

        async def on_agent_synthesis(self, value):
            assert value.conversation["conversation_id"] == "conversation-1"
            assert value.tool_results[0]["invocation_id"] == "invoke-1"
            return AgentSynthesisOutput("sunny", {"emotion_type": "neutral"}, value.trace_id)

        async def on_conversation_history(self, value):
            assert value.actor_id is None and value.cursor is None
            assert value.limit == 50 and value.allowed_scopes == ["conversation_private"]
            return ConversationHistoryResult(
                request_id=value.request_id, status="ok", next_cursor="next", has_more=True,
                conversation={"conversation_id": value.conversation_id, "thread_id": "main"},
                items=[ConversationHistoryEntry(
                    entry_id="entry-1", source_kind="moment", role="user", status="committed",
                    text="hello", occurred_at="2026-01-02T03:04:05Z", position=7,
                    conversation_id=value.conversation_id, scene_id=value.scene_id,
                    thread_id=value.thread_id, recall_scope="conversation_private",
                    disclosure_scope="conversation_private",
                )],
            )

    host._inbound = Inbound()
    initialize = _call(channel, "InitializeKnowledge", cognition_pb.InitializeKnowledgeRequest, cognition_pb.InitializeKnowledgeResponse)
    initialized = await initialize(cognition_pb.InitializeKnowledgeRequest(
        call=_metadata("generation-1", "knowledge-trace", "knowledge-1"), version="v1",
        entries=[cognition_pb.KnowledgeEntry(entry_id="fact-1", scope="knowledge", content="fact", enabled=True, priority=1)],
    ), timeout=1)
    assert initialized.status == "initialized"

    plan = _call(channel, "Plan", cognition_pb.PlanRequest, cognition_pb.PlanResponse)
    request = cognition_pb.PlanRequest(call=_metadata("generation-1", "plan-trace"), user_goal="weather")
    tool = request.available_tools.add(skill_id="weather", tool_name="lookup")
    ParseDict({"type": "object"}, tool.parameters_schema)
    planned = await plan(request, timeout=1)
    assert planned.trace_id == "plan-trace"
    assert planned.suggestions[0].skill_id == "weather"
    assert MessageToDict(planned.suggestions[0].arguments_hint) == {"city": "Shanghai"}

    synthesize = _call(channel, "Synthesize", cognition_pb.SynthesizeRequest, cognition_pb.SynthesizeResponse)
    synthesized = await synthesize(cognition_pb.SynthesizeRequest(
        call=_metadata("generation-1", "synthesis-trace"), original_goal="weather",
        conversation=_conversation("interaction-1"),
        tool_results=[cognition_pb.ToolResult(tool_name="lookup", status="succeeded", invocation_id="invoke-1")],
    ), timeout=1)
    assert synthesized.reply_content == "sunny"
    assert synthesized.trace_id == "synthesis-trace"
    assert MessageToDict(synthesized.emotion_state) == {"emotion_type": "neutral"}

    history = _call(channel, "GetConversationHistory", cognition_pb.GetConversationHistoryRequest, cognition_pb.GetConversationHistoryResponse)
    result = await history(cognition_pb.GetConversationHistoryRequest(
        call=_metadata("generation-1", "history-trace"), request_id="history-1",
        conversation_id="conversation-1", scene_id="scene-1", thread_id="main",
        allowed_scopes=["conversation_private"],
    ), timeout=1)
    assert result.request_id == "history-1"
    assert result.conversation.conversation_id == "conversation-1"
    assert result.next_cursor == "next" and result.has_more
    assert result.items[0].position == 7
    assert result.items[0].text == "hello"


class RequestTransport:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    async def request(self, method: str, payload: dict[str, object]) -> dict[str, object]:
        self.calls.append((method, payload))
        if method == "capability.expose":
            return {"capabilities": [{
                "name": "weather.lookup", "description": "weather", "input_schema": {},
            }]}
        if method == "capability.invoke":
            return {"status": "succeeded", "output": {"condition": "sunny"}}
        if method == "job.request":
            return {"job_id": "job-1", "status": "accepted", "revision": 1}
        raise AssertionError(method)


class ModelTransport:
    async def stream(self, payload: dict[str, object]):
        assert payload["user"] == "weather"
        yield {"sequence": 0, "kind": "text_delta", "payload": {"text": "sunny"}}
        yield {"sequence": 1, "kind": "completed", "payload": {}}

    async def cancel(self, session_id: str) -> None:
        return None


class ContentTransport:
    def __init__(self, content: bytes) -> None:
        self.content = content

    async def read(self, asset_id: str, *, max_bytes: int) -> bytes:
        return self.content


async def test_clients_preserve_ids_scopes_and_native_model_events() -> None:
    transport = RequestTransport()
    capabilities = CapabilityClient(transport)
    exposed = await capabilities.expose(scope="conversation:test")
    result = await capabilities.invoke(CapabilityInvocation(
        run_id="run-1", step=1, call_id="call-1", name=exposed[0].name,
        arguments={"city": "Shanghai"}, idempotency_key="run-1:call-1",
    ))
    receipt = await JobClient(transport).request(JobRequest(
        request_id="request-1", goal_id="goal-1", kind="reminder",
        idempotency_key="goal-1:request-1",
    ))
    events = [event async for event in ModelClient(ModelTransport()).events(
        InferenceRequest(system="system", user="weather")
    )]

    assert result.call_id == "call-1" and result.status == "succeeded"
    assert receipt.job_id == "job-1" and receipt.revision == 1
    assert [event.kind for event in events] == [
        ModelEventKind.TEXT_DELTA, ModelEventKind.COMPLETED,
    ]
    assert transport.calls[1][1]["idempotency_key"] == "run-1:call-1"


async def test_content_client_rejects_digest_mismatch() -> None:
    content = b"verified"
    valid = ContentReference(
        asset_id="asset-1", media_type="text/plain", size_bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
    )
    client = ContentClient(ContentTransport(content))
    assert await client.read(valid, max_bytes=100) == content

    invalid = ContentReference(
        asset_id="asset-1", media_type="text/plain", size_bytes=len(content),
        sha256="0" * 64,
    )
    with pytest.raises(ValueError, match="digest"):
        await client.read(invalid, max_bytes=100)


def _write_asset(root: Path, asset_id: str, media_type: str, data: bytes) -> dict:
    reference = {
        "asset_id": asset_id,
        "media_type": media_type,
        "size_bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    folder = root / asset_id
    folder.mkdir(parents=True)
    (folder / "blob").write_bytes(data)
    (folder / "metadata.json").write_text(json.dumps({
        "assetId": asset_id,
        "mediaType": media_type,
        "sizeBytes": len(data),
        "sha256": reference["sha256"],
    }), encoding="utf-8")
    return reference


def _multimodal_router(reader: FileAssetReader) -> MultimodalRouter:
    return MultimodalRouter(InferenceSettings(
        model=ModelSettings(
            max_tokens=1024, temperature=0.8, top_p=0.9, frequency_penalty=0
        ),
        life_clock=LifeClockSettings(
            heartbeat_enabled=False, heartbeat_interval_ms=45000,
            focus_duration_ms=20000, ingress_debounce_ms=1400,
            ingress_focused_debounce_ms=700, ingress_max_batch_messages=4,
            ingress_max_batch_items=24, summon_keywords=[], focus_on_any_chat=False,
        ),
        multimodal=MultimodalSettings(
            enabled=True, strategy="core_direct", max_items=6,
            core_model="vision", image_model="", video_model="",
        ),
    ), reader)


async def test_restarted_asset_reader_verifies_and_routes_media(tmp_path: Path) -> None:
    state = tmp_path / "state"
    image = _write_asset(state, "00000000-0000-4000-8000-000000000001", "image/png", b"png")
    audio = _write_asset(state, "00000000-0000-4000-8000-000000000002", "audio/wav", b"wav")
    video = _write_asset(state, "00000000-0000-4000-8000-000000000003", "video/mp4", b"mp4")
    document = _write_asset(state, "00000000-0000-4000-8000-000000000004", "application/pdf", b"pdf")
    reader = FileAssetReader(state, tmp_path / "work")
    route = await _multimodal_router(reader).route({"text": "看和听", "parts": [
        {"content": {"image": image}},
        {"content": {"audio": audio}, "semantic": {"text": "你好", "resolved": True}},
        {"content": {"video": video}},
        {"content": {"file": {"asset": document, "name": "a.pdf"}}},
    ]})
    assert route.vision_messages[0].uri == "data:image/png;base64,cG5n"
    assert "[语音1] 你好" in route.semantic_text
    assert "视频" in route.semantic_text and "文件理解能力" in route.semantic_text
    assert not any(
        message.mime_type.startswith(("audio/", "video/"))
        for message in route.vision_messages
    )

    (state / image["asset_id"] / "blob").write_bytes(b"bad")
    with pytest.raises(ValueError, match="损坏"):
        FileAssetReader(state, tmp_path / "work").verify(image)
    degraded = await _multimodal_router(FileAssetReader(state, tmp_path / "work")).route({
        "parts": [{"content": {"image": image}}]
    })
    assert degraded.vision_messages == []
    assert "视觉能力当前不可用" in degraded.semantic_text


async def test_legacy_media_degrades_without_forged_asset(tmp_path: Path) -> None:
    route = await _multimodal_router(
        FileAssetReader(tmp_path / "missing", tmp_path / "work")
    ).route({"items": [
        {"modality": "video", "uri": "https://expired.example/voice", "mime_type": "audio/wav"},
        {"modality": "video", "uri": "https://expired.example/video", "mime_type": "video/mp4"},
    ]})
    assert len(route.audio_items) == 1
    assert len(route.video_items) == 1
    assert route.vision_messages == []
    assert "当前没有可用的转写文本" in route.semantic_text


class _PlanningLLM:
    def __init__(self) -> None:
        self.requests = []

    async def generate(self, request):
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


async def test_agent_plan_preserves_kernel_skill_identity() -> None:
    llm = _PlanningLLM()
    use_case = AgentPlanUseCase(
        ids=DeterministicIds(), observability=NullObservability(), llm_engine=llm
    )
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


def _model_settings() -> ModelSettings:
    return ModelSettings(
        max_tokens=1024, temperature=0.8, top_p=0.9, frequency_penalty=0.0
    )


def test_llm_provider_resolution_uses_models_contract() -> None:
    engine = LLMEngine(_model_settings(), LLMSettings(
        api_type="deepseek",
        api_key="test-key",
        base_url="https://api.deepseek.com",
        models={"chat": "deepseek-chat"},
        providers={
            "qwen": {
                "api_type": "openai",
                "api_key": "provider-key",
                "base_url": "https://dashscope.aliyuncs.com",
                "models": {"vision": "qwen-vl-plus", "chat": "qwen-plus"},
            }
        },
    ))

    root = engine._resolve_provider_config(None)
    vision = engine._resolve_provider_config("qwen/vision")
    assert root is not None and root.models == {"default": "deepseek-chat"}
    assert not hasattr(root, "model")
    assert vision is not None and vision.models == {"default": "qwen-vl-plus"}
    assert vision.api_key == "provider-key"


async def test_llm_gateway_fails_closed_without_or_for_unknown_provider() -> None:
    with pytest.raises(InferenceException, match="真实 LLM provider"):
        await LLMEngine(_model_settings(), None).generate(ModelRequest(
            messages=[ModelMessage(role="user", content="你好")]
        ))

    configured = LLMEngine(_model_settings(), LLMSettings(
        api_type="openai", api_key="test-key", models={"chat": "test-model"}
    ))
    with pytest.raises(InferenceException, match="未知 LLM provider"):
        await configured.generate(
            ModelRequest(messages=[ModelMessage(role="user", content="你好")]),
            provider_key="missing/chat",
        )


async def test_multimodal_router_accepts_null_items_and_never_sends_audio_to_vision() -> None:
    settings = InferenceSettings(
        model=_model_settings(),
        life_clock=LifeClockSettings(
            heartbeat_enabled=False, heartbeat_interval_ms=45000,
            focus_duration_ms=20000, ingress_debounce_ms=1400,
            ingress_focused_debounce_ms=700, ingress_max_batch_messages=4,
            ingress_max_batch_items=24, summon_keywords=[], focus_on_any_chat=False,
        ),
        multimodal=MultimodalSettings(
            enabled=True, strategy="core_direct", max_items=6,
            core_model="vision", image_model="", video_model="",
        ),
    )
    router = MultimodalRouter(settings)
    text = await router.route({"text": "你好", "modality": ["text"], "items": None})
    assert text.primary_text == "你好" and text.vision_messages == []

    route = await router.route({"text": "听一下", "items": [
        {"modality": "audio", "uri": "https://example.test/new.wav", "mime_type": "audio/wav"},
        {"modality": "video", "uri": "https://example.test/old.wav", "mime_type": "audio/wav"},
        {"modality": "audio", "semantic": {"text": "你好", "resolved": True}},
    ]})
    assert route.vision_messages == []
    assert len(route.audio_items) == 3
    assert route.semantic_text.count("当前没有可用的转写文本") == 2
    assert "[语音3] 你好" in route.semantic_text
    assert "new.wav" not in route.semantic_text and "old.wav" not in route.semantic_text

    disabled = settings.model_copy(update={
        "multimodal": settings.multimodal.model_copy(update={"enabled": False})
    })
    disabled_route = await MultimodalRouter(disabled).route({"items": [
        {"modality": "audio", "semantic": {"text": "准确转写", "resolved": True}}
    ]})
    assert disabled_route.semantic_text == "[语音1] 准确转写"
    assert disabled_route.vision_messages == []


class _PersonaCompiler:
    def build_persona_prompt(
        self, emotion_state: dict, address_mode: str = "direct"
    ) -> str:
        del emotion_state
        del address_mode
        return (
            "你是月见（Selrena）。\n[表达倾向]\n用自然、带一点迟疑的中文回应。\n"
            "[对话策略]\n保持角色语气，不输出内部规则。"
        )


class _SynthesisLLM:
    def __init__(self, text: str = "我这里没能确认成功，但可以把结果先告诉你。") -> None:
        self.text = text
        self.requests = []

    async def generate(self, request):
        self.requests.append(request)
        return self.text


async def test_agent_synthesis_uses_persona_and_reports_tool_errors() -> None:
    llm = _SynthesisLLM()
    use_case = AgentSynthesisUseCase(
        nickname="月见",
        llm_engine=llm,
        persona_compiler=_PersonaCompiler(),
        ids=DeterministicIds(),
        observability=NullObservability(),
    )
    output = await use_case.execute(AgentSynthesisInput(
        original_goal="查一下今天上海天气",
        tool_results=[{
            "tool_name": "weather.lookup",
            "status": "succeeded",
            "result_json": '{"city":"上海","weather":"多云"}',
        }],
    ), trace_id="trace-synthesis")
    assert output.reply_content == llm.text
    system_prompt = llm.requests[0].messages[0].content
    assert "你是月见（Selrena）。" in system_prompt
    assert "[表达倾向]" in system_prompt
    assert "[外部能力结果处理]" in system_prompt
    assert "不可信观察" in system_prompt
    assert "情绪标签" not in system_prompt

    error_llm = _SynthesisLLM("这次外部结果没有成功返回，我不能假装已经完成。")
    error_case = AgentSynthesisUseCase(
        nickname="月见",
        llm_engine=error_llm,
        persona_compiler=_PersonaCompiler(),
        ids=DeterministicIds(),
        observability=NullObservability(),
    )
    error_output = await error_case.execute(AgentSynthesisInput(
        original_goal="打开 B 站",
        tool_results=[{
            "tool_name": "browser.open",
            "status": "error",
            "result_json": '{"message":"permission denied"}',
        }],
    ), trace_id="trace-synthesis-error")
    assert "不能假装" in error_output.reply_content
    assert "[error] browser.open" in error_llm.requests[0].messages[1].content
    assert "permission denied" in error_llm.requests[0].messages[1].content


async def test_agent_synthesis_records_causal_tool_result_and_replays(
    tmp_path: Path,
) -> None:
    recorder = build_test_recorder(tmp_path / "experience")
    await recorder.start()
    turn_controller = TurnController(
        SqliteTurnStore(tmp_path / "turns.db"), clock=FixedClock()
    )
    await turn_controller.connect()
    accepted = await turn_controller.accept(ConversationTurn(
        turn_id="trace-tool",
        scene_id="desktop",
        conversation_id="conversation-1",
        continuity_id="continuity-1",
        thread_id="main",
        payload_digest="sha256:trace-tool",
    ))
    await turn_controller.start(accepted.turn_id, expected_revision=accepted.revision)
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
        llm_engine=_SynthesisLLM("已经打开。"),
        persona_compiler=_PersonaCompiler(),
        ids=DeterministicIds(),
        observability=NullObservability(),
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
    first = await use_case.execute(synthesis_input, trace_id="trace-tool")
    await recorder.flush()
    moments = recorder.log.query()
    tool_call = next(
        moment for moment in moments
        if moment.kind == MomentKind.ACTION.value
        and moment.content.get("action_type") == "tool_call"
    )
    action_result = next(
        moment for moment in moments if moment.kind == MomentKind.ACTION_RESULT.value
    )
    reply = next(moment for moment in moments if moment.kind == MomentKind.REPLY.value)
    assert request is not None and tool_call.causation_ids == (request.moment_id,)
    assert tool_call.origin.schema_ref == "glimmer://capability/tool-call/v1"
    assert action_result.origin.provider_id == "browser-extension"
    assert action_result.causation_ids == (tool_call.moment_id,)
    assert reply.content == {"text": "已经打开。", "length": 5}
    assert reply.causation_ids == (action_result.moment_id,)
    assert [tool_call.seq, action_result.seq, reply.seq] == sorted(
        [tool_call.seq, action_result.seq, reply.seq]
    )
    completed = await turn_controller.load("trace-tool")
    assert completed is not None and completed.status == "completed"

    replay = await use_case.execute(synthesis_input, trace_id="trace-tool")
    await recorder.flush()
    assert replay.reply_content == first.reply_content
    assert len(recorder.log.query()) == 4
    await turn_controller.close()
    await recorder.stop()


def AttentionController(*args, **kwargs):
    kwargs.setdefault("clock", FixedClock())
    return _AttentionController(*args, **kwargs)


def PerceptionProvider(*args, **kwargs):
    kwargs.setdefault("clock", FixedClock())
    kwargs.setdefault("ids", DeterministicIds())
    return _PerceptionProvider(*args, **kwargs)


def CycleController(*args, **kwargs):
    kwargs.setdefault("clock", FixedClock())
    kwargs.setdefault("ids", DeterministicIds())
    kwargs.setdefault("observability", NullObservability())
    return _CycleController(*args, **kwargs)


class _Queue:
    def __init__(self, max_size: int | None = None) -> None:
        self.entries = []
        self.max_size = max_size

    def put(self, entry):
        dropped = None
        if self.max_size is not None and len(self.entries) >= self.max_size:
            dropped = self.entries.pop(0)
        self.entries.append(entry)
        return dropped

    def remove(self, trace_id: str) -> bool:
        before = len(self.entries)
        self.entries = [entry for entry in self.entries if entry.trace_id != trace_id]
        return len(self.entries) != before


class _Activity:
    def engage(self, _reason: str) -> None:
        pass

    def observe_activity(self, _reason: str) -> None:
        pass


class _Cycle:
    def notify_external_input(self) -> None:
        pass


class _Inbound:
    async def on_knowledge_init(self, _knowledge) -> None:
        pass

    async def on_agent_plan(self, input_data):
        if input_data.user_goal == "wait":
            await asyncio.sleep(30)
        return AgentPlanResult(
            summary="ok",
            reasoning="tested",
            suggestions=[],
            trace_id=input_data.trace_id,
        )

    async def on_agent_synthesis(self, _input_data):
        raise AssertionError("not used")

    async def on_conversation_history(self, _payload):
        raise AssertionError("not used")


def _metadata(generation: str, trace_id: str, key: str = ""):
    return common_pb.CallMetadata(
        trace_id=trace_id,
        causation_id="cause-1",
        correlation_id="correlation-1",
        generation=generation,
        idempotency_key=key,
    )


def _conversation(interaction_id: str) -> cognition_pb.ConversationContext:
    return cognition_pb.ConversationContext(
        scene_id="scene-1",
        conversation_id="conversation-1",
        continuity_id="continuity-1",
        thread_id="main",
        interaction_id=interaction_id,
        recall_scope="conversation_private",
        disclosure_scope="conversation_private",
    )


def _call(channel, method: str, request_type, response_type):
    return channel.unary_unary(
        f"/glimmer.cognition.v1.CognitionService/{method}",
        request_serializer=request_type.SerializeToString,
        response_deserializer=response_type.FromString,
    )


@pytest.fixture
async def service():
    stopped = asyncio.Event()

    async def shutdown() -> None:
        stopped.set()

    queue = _Queue()
    host = CognitionGrpcHost(
        generation="generation-1",
        inbound=_Inbound(),
        queue=queue,
        activity=_Activity(),
        cycle=_Cycle(),
        shutdown=shutdown,
        operations=PerceptionOperationRegistry(),
        workspace=AttentionController(),
    )
    await host.start()
    host.mark_ready()
    channel = grpc.aio.insecure_channel(host.endpoint.removeprefix("grpc://"))
    try:
        yield host, channel, queue, stopped
    finally:
        await channel.close()
        await host.stop()


@pytest.fixture
async def memory_job_service(service, tmp_path):
    host, channel, _, _ = service
    recorder = build_test_recorder(tmp_path / "job-log")
    await recorder.start()
    moment = recorder.record(MomentKind.PERCEPTION, {"text": "持久事实"}, interaction_id="job-turn",
                             conversation_id="job-conversation", retention_ceiling="memory_candidate", importance=0.9)
    database = SqliteMemoryStore(tmp_path / "job-memory.sqlite")
    await database.connect()
    memory = MemoryController(clock=FixedClock())
    memory.bind_repository(MemoryRepository(database))
    await memory.load()
    episodes = EpisodeProjection(tmp_path / "job-episodes.db", recorder)

    class Llm:
        calls = 0

        async def generate(self, _request):
            self.calls += 1
            return json.dumps({"decisions": [{"operation": "add", "kind": "semantic",
                "content": "持久事实", "summary": "事实", "evidence_moment_ids": [moment.moment_id]}]})

    llm = Llm()
    coordinator = ConsolidationCoordinator(episodes=episodes, memory=memory, jobs=ConsolidationJobRepository(database),
        llm=llm, clock=FixedClock(), ids=DeterministicIds(), observability=NullObservability())
    await coordinator.start()
    await episodes.project_pending(seal=True)
    item = coordinator._receipt_input(episodes.pending_consolidation()[0])
    host._consolidation = coordinator
    identity = jobs_pb.JobExecutionIdentity(job_id="memory-job", scope_id=item.scope_id, attempt=1,
        authority_epoch=1, fencing_token=1, owner_id="host-one", lease_until_ms=int(time.time() * 1000) + 60000)
    request = cognition_pb.ExecuteMemoryJobRequest(call=_metadata("generation-1", "job-execute"), identity=identity,
        episode_id=item.episode_id, episode_version=item.episode_version, input_digest=item.input_digest)
    execute = _call(channel, "ExecuteMemoryJob", cognition_pb.ExecuteMemoryJobRequest, cognition_pb.ExecuteMemoryJobResponse)
    reconcile = _call(channel, "ReconcileMemoryJob", cognition_pb.ReconcileMemoryJobRequest, cognition_pb.ReconcileMemoryJobResponse)
    try:
        yield database, memory, coordinator, llm, request, execute, reconcile
    finally:
        await host.stop()
        await recorder.stop()
        await database.close()


async def test_memory_job_rpc_persists_original_identity_and_reconciles_after_reopen(memory_job_service):
    database, memory, _, llm, request, execute, reconcile = memory_job_service
    applied = (await execute(request, timeout=2)).result
    assert applied.resolution == cognition_pb.MEMORY_JOB_RESOLUTION_APPLIED
    assert applied.identity == request.identity and applied.source_id == "cognition.memory"
    assert len(applied.memory_ids) == 1 and applied.evidence_id
    duplicate = (await execute(request, timeout=2)).result
    assert duplicate.duplicate and duplicate.receipt_id == applied.receipt_id
    assert llm.calls == 1
    await database.close()
    await database.connect()
    recovered = (await reconcile(cognition_pb.ReconcileMemoryJobRequest(
        call=_metadata("generation-1", "job-reconcile"), identity=request.identity), timeout=2)).result
    assert recovered.receiver_fenced and recovered.receipt_id == applied.receipt_id
    assert recovered.identity == request.identity and recovered.evidence_id == applied.evidence_id
    assert recovered.observed_at_ms == applied.observed_at_ms
    assert memory.count() == 1


async def test_memory_job_rpc_absent_query_seals_late_execute(memory_job_service):
    _, memory, _, llm, request, execute, reconcile = memory_job_service
    proof = (await reconcile(cognition_pb.ReconcileMemoryJobRequest(
        call=_metadata("generation-1", "seal-before-arrival"), identity=request.identity), timeout=2)).result
    assert proof.resolution == cognition_pb.MEMORY_JOB_RESOLUTION_NOT_APPLIED
    assert proof.receiver_fenced and not proof.receipt_id
    with pytest.raises(grpc.aio.AioRpcError) as rejected:
        await execute(request, timeout=2)
    assert rejected.value.code() is grpc.StatusCode.FAILED_PRECONDITION
    detail = common_pb.ServiceErrorDetail()
    detail.ParseFromString(dict(rejected.value.trailing_metadata())["glimmer-error-bin"])
    assert detail.code == common_pb.SERVICE_ERROR_CODE_RECOVERY_REQUIRED
    assert list(detail.recovery_actions) == [common_pb.SERVICE_RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE]
    assert memory.count() == 0 and llm.calls == 0


async def test_memory_job_rpc_shutdown_cancels_every_task_even_with_same_trace(memory_job_service, service, monkeypatch):
    _, memory, _, llm, request, execute, _ = memory_job_service
    host, _, _, _ = service
    entered = asyncio.Event()

    async def delayed(_request):
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(llm, "generate", delayed)
    first = execute(request, timeout=5)
    await asyncio.wait_for(entered.wait(), 2)
    second = execute(request, timeout=5)
    for _ in range(100):
        if len(host._inflight) == 2:
            break
        await asyncio.sleep(0.01)
    assert len(host._inflight) == 2
    await host.stop()
    results = await asyncio.gather(first, second, return_exceptions=True)
    assert all(isinstance(result, BaseException) for result in results)
    assert host._inflight == {} and memory.count() == 0


@pytest.mark.parametrize("mode", ["generation", "scope", "unsafe_integer", "missing_identity"])
async def test_memory_job_rpc_invalid_identity_never_infers(memory_job_service, mode):
    _, memory, _, llm, request, execute, _ = memory_job_service
    if mode == "generation":
        request.call.generation = "old"
    elif mode == "scope":
        request.identity.scope_id = "wrong"
    elif mode == "unsafe_integer":
        request.identity.fencing_token = 9007199254740992
    else:
        request.ClearField("identity")
    with pytest.raises(grpc.aio.AioRpcError):
        await execute(request, timeout=2)
    assert memory.count() == 0 and llm.calls == 0


@pytest.mark.asyncio
async def test_perception_is_versioned_idempotent_and_generation_scoped(service):
    _host, channel, queue, _stopped = service
    submit = _call(channel, "SubmitPerception", cognition_pb.SubmitPerceptionRequest, cognition_pb.SubmitPerceptionResponse)
    request = cognition_pb.SubmitPerceptionRequest(
        call=_metadata("generation-1", "trace-1", "perception-1"),
        perception_id="perception-1",
        familiarity=10,
        address_mode=cognition_pb.ADDRESS_MODE_DIRECT,
        response_policy=cognition_pb.RESPONSE_POLICY_REPLY_ALLOWED,
        retention_ceiling=cognition_pb.RETENTION_CEILING_EXPERIENCE,
        conversation=cognition_pb.ConversationContext(
            scene_id="scene-1",
            conversation_id="conversation-1",
            continuity_id="continuity-1",
            thread_id="main",
            interaction_id="trace-1",
            recall_scope="conversation_private",
            disclosure_scope="conversation_private",
        ),
        origin=cognition_pb.SourceDescriptor(content_hash="a" * 64),
        content=cognition_pb.PerceptionContent(text="hello", parts=[
            cognition_pb.PerceptionPart(content=content_pb.ContentPart(text="hello")),
            cognition_pb.PerceptionPart(content=content_pb.ContentPart(image=content_pb.AssetRef(
                asset_id="00000000-0000-4000-8000-000000000001", media_type="image/png", size_bytes=3, sha256="a" * 64))),
            cognition_pb.PerceptionPart(content=content_pb.ContentPart(audio=content_pb.AssetRef(
                asset_id="00000000-0000-4000-8000-000000000002", media_type="audio/wav", size_bytes=3, sha256="b" * 64))),
            cognition_pb.PerceptionPart(content=content_pb.ContentPart(video=content_pb.AssetRef(
                asset_id="00000000-0000-4000-8000-000000000003", media_type="video/mp4", size_bytes=3, sha256="c" * 64))),
            cognition_pb.PerceptionPart(content=content_pb.ContentPart(file=content_pb.FileContent(
                asset=content_pb.AssetRef(asset_id="00000000-0000-4000-8000-000000000004",
                    media_type="application/pdf", size_bytes=3, sha256="d" * 64), name="a.pdf"))),
        ]),
    )
    first = await submit(request, timeout=1)
    second = await submit(request, timeout=1)
    assert first.state == cognition_pb.PERCEPTION_OPERATION_STATE_ACCEPTED
    assert second.duplicate is True
    assert len(queue.entries) == 1
    assert queue.entries[0].trace_id == "trace-1"
    assert queue.entries[0].payload_digest == "a" * 64
    assert [next(iter(part["content"])) for part in queue.entries[0].model_input["parts"]] == [
        "text", "image", "audio", "video", "file",
    ]

    conflicting_trace = cognition_pb.SubmitPerceptionRequest()
    conflicting_trace.CopyFrom(request)
    conflicting_trace.call.trace_id = "trace-conflict"
    with pytest.raises(grpc.aio.AioRpcError) as operation_conflict:
        await submit(conflicting_trace, timeout=1)
    assert operation_conflict.value.code() is grpc.StatusCode.INVALID_ARGUMENT

    conflicting_operation = cognition_pb.SubmitPerceptionRequest()
    conflicting_operation.CopyFrom(request)
    conflicting_operation.call.idempotency_key = "perception-other"
    with pytest.raises(grpc.aio.AioRpcError) as trace_conflict:
        await submit(conflicting_operation, timeout=1)
    assert trace_conflict.value.code() is grpc.StatusCode.INVALID_ARGUMENT
    assert len(queue.entries) == 1

    request.call.generation = "stale-generation"
    with pytest.raises(grpc.aio.AioRpcError) as caught:
        await submit(request, timeout=1)
    assert caught.value.code() is grpc.StatusCode.PERMISSION_DENIED
    detail = dict(caught.value.trailing_metadata())["glimmer-error-bin"]
    error = common_pb.ServiceErrorDetail.FromString(detail)
    assert error.code == common_pb.SERVICE_ERROR_CODE_GENERATION_MISMATCH
    assert error.call.causation_id == "cause-1"
    assert error.call.correlation_id == "correlation-1"


@pytest.mark.asyncio
async def test_queue_capacity_drop_closes_the_accepted_perception_operation() -> None:
    operations = PerceptionOperationRegistry()
    host = CognitionGrpcHost(
        generation="generation-capacity",
        inbound=_Inbound(),
        queue=_Queue(max_size=1),
        activity=_Activity(),
        cycle=_Cycle(),
        shutdown=lambda: asyncio.sleep(0),
        operations=operations,
        workspace=AttentionController(),
    )
    await host.start()
    host.mark_ready()
    channel = grpc.aio.insecure_channel(host.endpoint.removeprefix("grpc://"))
    submit = _call(channel, "SubmitPerception", cognition_pb.SubmitPerceptionRequest, cognition_pb.SubmitPerceptionResponse)
    status = _call(channel, "GetPerceptionOperation", cognition_pb.GetPerceptionOperationRequest, cognition_pb.GetPerceptionOperationResponse)
    try:
        for trace_id in ("trace-old", "trace-new"):
            await submit(cognition_pb.SubmitPerceptionRequest(
                call=_metadata("generation-capacity", trace_id, f"operation:{trace_id}"),
                perception_id=trace_id,
                conversation=_conversation(trace_id),
                content=cognition_pb.PerceptionContent(text=trace_id),
            ), timeout=1)
        dropped = await status(cognition_pb.GetPerceptionOperationRequest(
            call=_metadata("generation-capacity", "status-old"),
            operation_id="operation:trace-old",
        ), timeout=1)
        assert dropped.terminal is True
        assert dropped.state == cognition_pb.PERCEPTION_OPERATION_STATE_FAILED
        assert dropped.safe_message == "感知队列容量已满"
    finally:
        await channel.close()
        await host.stop()


@pytest.mark.asyncio
async def test_unbound_observation_is_rejected_as_invalid_request(service) -> None:
    host, channel, queue, _stopped = service
    submit = _call(
        channel,
        "SubmitPerception",
        cognition_pb.SubmitPerceptionRequest,
        cognition_pb.SubmitPerceptionResponse,
    )
    request = cognition_pb.SubmitPerceptionRequest(
        call=_metadata("generation-1", "invalid-observation", "invalid-observation"),
        content=cognition_pb.PerceptionContent(text="missing context"),
    )
    for _ in range(2):
        with pytest.raises(grpc.aio.AioRpcError) as caught:
            await submit(request, timeout=1)
        assert caught.value.code() is grpc.StatusCode.INVALID_ARGUMENT
    assert host._operations.get("invalid-observation") is None
    assert queue.entries == []

    request.conversation.CopyFrom(_conversation("invalid-observation"))
    accepted = await submit(request, timeout=1)
    assert accepted.state == cognition_pb.PERCEPTION_OPERATION_STATE_ACCEPTED
    assert accepted.duplicate is False
    assert len(queue.entries) == 1


@pytest.mark.asyncio
async def test_deadline_and_perception_cancellation_reach_terminal_state(service):
    _host, channel, _queue, _stopped = service
    plan = _call(channel, "Plan", cognition_pb.PlanRequest, cognition_pb.PlanResponse)
    cancel = _call(channel, "CancelPerception", cognition_pb.CancelPerceptionRequest, cognition_pb.CancelPerceptionResponse)

    with pytest.raises(grpc.aio.AioRpcError) as deadline:
        await plan(cognition_pb.PlanRequest(call=_metadata("generation-1", "deadline-trace"), user_goal="wait"), timeout=0.03)
    assert deadline.value.code() is grpc.StatusCode.DEADLINE_EXCEEDED

    submit = _call(channel, "SubmitPerception", cognition_pb.SubmitPerceptionRequest, cognition_pb.SubmitPerceptionResponse)
    status = _call(channel, "GetPerceptionOperation", cognition_pb.GetPerceptionOperationRequest, cognition_pb.GetPerceptionOperationResponse)
    await submit(cognition_pb.SubmitPerceptionRequest(
        call=_metadata("generation-1", "cancel-trace", "perception-cancel"),
        address_mode=cognition_pb.ADDRESS_MODE_DIRECT,
        conversation=_conversation("cancel-trace"),
        content=cognition_pb.PerceptionContent(text="cancel me"),
    ), timeout=1)
    result = await cancel(cognition_pb.CancelPerceptionRequest(
        call=_metadata("generation-1", "cancel-command"),
        target_trace_id="cancel-trace",
        reason="test",
    ), timeout=1)
    assert result.state == cognition_pb.PERCEPTION_OPERATION_STATE_CANCELLED
    assert result.terminal is True
    terminal = await status(cognition_pb.GetPerceptionOperationRequest(
        call=_metadata("generation-1", "status-command"),
        operation_id="perception-cancel",
    ), timeout=1)
    assert terminal.terminal is True
    assert terminal.state == cognition_pb.PERCEPTION_OPERATION_STATE_CANCELLED


@pytest.mark.asyncio
async def test_second_ingress_cancels_the_real_cycle_through_grpc(tmp_path) -> None:
    started = asyncio.Event()
    emitted: list[dict] = []

    class _SlowReasoning:
        async def request(self, _request, *, tier):
            started.set()
            await asyncio.Future()

    queue = ObservationQueue(max_size=10)
    operations = PerceptionOperationRegistry()
    workspace = AttentionController(capacity=5)
    recorder = build_test_recorder(tmp_path)
    await recorder.start()
    cycle = CycleController(
        workspace=workspace,
        providers=[PerceptionProvider(queue)],
        experience_recorder=recorder,
        willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
        reasoning=_SlowReasoning(),
        action_sink=lambda command: _append_async(emitted, command),
        perception_operations=operations,
    )
    host = CognitionGrpcHost(
        generation="generation-cycle",
        inbound=_Inbound(),
        queue=queue,
        activity=_Activity(),
        cycle=cycle,
        shutdown=lambda: asyncio.sleep(0),
        operations=operations,
        workspace=workspace,
    )
    await host.start()
    host.mark_ready()
    channel = grpc.aio.insecure_channel(host.endpoint.removeprefix("grpc://"))
    submit = _call(channel, "SubmitPerception", cognition_pb.SubmitPerceptionRequest, cognition_pb.SubmitPerceptionResponse)
    cancel = _call(channel, "CancelPerception", cognition_pb.CancelPerceptionRequest, cognition_pb.CancelPerceptionResponse)
    status = _call(channel, "GetPerceptionOperation", cognition_pb.GetPerceptionOperationRequest, cognition_pb.GetPerceptionOperationResponse)
    try:
        await submit(_perception_request("generation-cycle", "trace-first", "operation:first", "first"), timeout=1)
        tick = asyncio.create_task(cycle.tick_once())
        await asyncio.wait_for(started.wait(), timeout=1)
        cancelled = await cancel(cognition_pb.CancelPerceptionRequest(
            call=_metadata("generation-cycle", "cancel-first"),
            target_trace_id="trace-first",
            reason="new_ingress_interrupt",
        ), timeout=1)
        await submit(_perception_request("generation-cycle", "trace-second", "operation:second", "second"), timeout=1)

        assert tick.cancelled()
        assert cancelled.terminal is True
        first_terminal = await status(cognition_pb.GetPerceptionOperationRequest(
            call=_metadata("generation-cycle", "status-first"), operation_id="operation:first",
        ), timeout=1)
        assert first_terminal.state == cognition_pb.PERCEPTION_OPERATION_STATE_CANCELLED
        assert queue.size() == 1
        assert emitted == []
    finally:
        await channel.close()
        await host.stop()
        await recorder.stop()


async def _append_async(target: list[dict], value: dict) -> None:
    target.append(value)


def _perception_request(generation: str, trace_id: str, operation_id: str, text: str):
    return cognition_pb.SubmitPerceptionRequest(
        call=_metadata(generation, trace_id, operation_id),
        familiarity=10,
        address_mode=cognition_pb.ADDRESS_MODE_DIRECT,
        response_policy=cognition_pb.RESPONSE_POLICY_REPLY_ALLOWED,
        conversation=_conversation(trace_id),
        content=cognition_pb.PerceptionContent(text=text),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["cancel", "deadline", "shutdown"])
async def test_synthesis_cancellation_reaches_the_running_use_case(mode: str) -> None:
    started = asyncio.Event()
    cancelled = asyncio.Event()

    class _SlowSynthesisInbound(_Inbound):
        async def on_agent_synthesis(self, _input_data):
            started.set()
            try:
                await asyncio.Future()
            finally:
                await asyncio.sleep(0.02)
                cancelled.set()

    host = CognitionGrpcHost(
        generation="generation-synthesis",
        inbound=_SlowSynthesisInbound(),
        queue=_Queue(),
        activity=_Activity(),
        cycle=_Cycle(),
        shutdown=lambda: asyncio.sleep(0),
        operations=PerceptionOperationRegistry(),
        workspace=AttentionController(),
    )
    await host.start()
    host.mark_ready()
    channel = grpc.aio.insecure_channel(host.endpoint.removeprefix("grpc://"))
    synthesize = _call(channel, "Synthesize", cognition_pb.SynthesizeRequest, cognition_pb.SynthesizeResponse)
    try:
        pending = synthesize(cognition_pb.SynthesizeRequest(
            call=_metadata("generation-synthesis", f"synthesis-{mode}"),
            original_goal="wait",
        ), timeout=0.03 if mode == "deadline" else 5)
        await asyncio.wait_for(started.wait(), timeout=1)
        if mode == "cancel":
            pending.cancel()
        elif mode == "shutdown":
            await host.stop()
            assert cancelled.is_set()
            assert host._inflight == {}
        with pytest.raises((asyncio.CancelledError, grpc.aio.AioRpcError)):
            await pending
        await asyncio.wait_for(cancelled.wait(), timeout=1)
    finally:
        await channel.close()
        await host.stop()


@pytest.mark.asyncio
async def test_readiness_and_shutdown_are_generation_bound(service):
    _host, channel, _queue, stopped = service
    readiness = _call(channel, "GetReadiness", cognition_pb.GetReadinessRequest, cognition_pb.GetReadinessResponse)
    shutdown = _call(channel, "Shutdown", cognition_pb.ShutdownRequest, cognition_pb.ShutdownResponse)
    ready = await readiness(cognition_pb.GetReadinessRequest(call=_metadata("generation-1", "ready-trace")), timeout=1)
    assert (ready.state, ready.phase, ready.generation) == ("ready", "ready", "generation-1")
    result = await shutdown(cognition_pb.ShutdownRequest(call=_metadata("generation-1", "shutdown-trace", "shutdown-1"), reason="test"), timeout=1)
    assert result.status == "accepted"
    await asyncio.wait_for(stopped.wait(), timeout=1)
    draining = await readiness(cognition_pb.GetReadinessRequest(call=_metadata("generation-1", "drain-trace")), timeout=1)
    assert (draining.state, draining.phase) == ("stopping", "stopping")
    repeated = await shutdown(cognition_pb.ShutdownRequest(call=_metadata("generation-1", "shutdown-trace", "shutdown-1")), timeout=1)
    assert repeated.duplicate and repeated.status == "duplicate"
    submit = _call(channel, "SubmitPerception", cognition_pb.SubmitPerceptionRequest, cognition_pb.SubmitPerceptionResponse)
    with pytest.raises(grpc.aio.AioRpcError) as rejected:
        await submit(cognition_pb.SubmitPerceptionRequest(
            call=_metadata("generation-1", "late-input", "late-input"),
            conversation=_conversation("late-input"), content=cognition_pb.PerceptionContent(text="late"),
        ), timeout=1)
    assert rejected.value.code() == grpc.StatusCode.FAILED_PRECONDITION
    assert _host._operations.get("late-input") is None
    assert not _queue.entries


@pytest.mark.asyncio
async def test_kernel_typed_error_preserves_safe_metadata_without_raw_details():
    detail = common_pb.ServiceErrorDetail(
        code=common_pb.SERVICE_ERROR_CODE_NOT_READY,
        safe_message="Kernel action handler 尚未就绪",
        retryable=True,
        call=_metadata("generation-1", "trace-safe"),
    )

    class _Channel:
        def unary_unary(self, *_args, **_kwargs):
            async def invoke(_request, timeout=None):
                raise grpc.aio.AioRpcError(
                    grpc.StatusCode.FAILED_PRECONDITION,
                    trailing_metadata=(("glimmer-error-bin", detail.SerializeToString()),),
                    details="private stack and provider token",
                )
            return invoke

    client = KernelGrpcClient("generation-1", "nonce", "AA")
    client._channel = _Channel()  # type: ignore[assignment]
    with pytest.raises(KernelServiceError) as caught:
        await client._call("PublishLog", kernel_pb.PublishLogRequest(), kernel_pb.PublishLogRequest, kernel_pb.PublishLogResponse)
    assert caught.value.code == common_pb.SERVICE_ERROR_CODE_NOT_READY
    assert caught.value.safe_message == "Kernel action handler 尚未就绪"
    assert caught.value.retryable is True
    assert caught.value.call.trace_id == "trace-safe"
    assert caught.value.call.causation_id == "cause-1"
    assert caught.value.call.correlation_id == "correlation-1"
    assert caught.value.call.generation == "generation-1"
    assert "private stack" not in str(caught.value)


@pytest.mark.asyncio
async def test_kernel_manual_recovery_is_programmatic_and_not_message_driven():
    detail = common_pb.ServiceErrorDetail(
        code=common_pb.SERVICE_ERROR_CODE_RECOVERY_REQUIRED,
        safe_message="localized text may change",
        retryable=False,
        call=_metadata("generation-1", "trace-recovery"),
        recovery_actions=[common_pb.SERVICE_RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE],
        operation_id="action:unsafe:tool:0",
    )

    class _Channel:
        def unary_unary(self, *_args, **_kwargs):
            async def invoke(_request, timeout=None):
                raise grpc.aio.AioRpcError(
                    grpc.StatusCode.FAILED_PRECONDITION,
                    trailing_metadata=(("glimmer-error-bin", detail.SerializeToString()),),
                    details="untrusted transport text",
                )
            return invoke

    client = KernelGrpcClient("generation-1", "nonce", "AA")
    client._channel = _Channel()  # type: ignore[assignment]
    with pytest.raises(KernelServiceError) as caught:
        await client._call(
            "PublishAction",
            kernel_pb.PublishActionRequest(),
            kernel_pb.PublishActionRequest,
            kernel_pb.PublishActionResponse,
        )
    assert caught.value.code == common_pb.SERVICE_ERROR_CODE_RECOVERY_REQUIRED
    assert caught.value.retryable is False
    assert caught.value.operation_id == "action:unsafe:tool:0"
    assert caught.value.recovery_actions == (
        common_pb.SERVICE_RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE,
    )
    assert caught.value.call.trace_id == "trace-recovery"
