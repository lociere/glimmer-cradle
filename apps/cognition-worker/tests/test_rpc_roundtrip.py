import hashlib
import json
from pathlib import Path

import pytest

from glimmer_cradle.cognition.inference import (
    InferenceRequest,
    InferenceSettings,
    LifeClockSettings,
    ModelEventKind,
    ModelSettings,
    MultimodalSettings,
)
from glimmer_cradle.cognition.ports import (
    AgentPlanInput,
    CapabilityInvocation,
    ContentReference,
    JobRequest,
    SkillToolDescriptor,
)
from glimmer_cradle.cognition_worker.adapters import (
    CapabilityClient,
    ContentClient,
    JobClient,
    ModelClient,
    FileAssetReader,
)
from glimmer_cradle.cognition_worker.adapters.model_client import (
    InferenceException,
    LLMEngine,
    LLMSettings,
    ModelMessage,
    ModelRequest,
    MultimodalRouter,
)
from glimmer_cradle.cognition_worker.composition import AgentPlanUseCase
from conftest import DeterministicIds, NullObservability


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


def test_restarted_asset_reader_verifies_and_routes_media(tmp_path: Path) -> None:
    state = tmp_path / "state"
    image = _write_asset(state, "00000000-0000-4000-8000-000000000001", "image/png", b"png")
    audio = _write_asset(state, "00000000-0000-4000-8000-000000000002", "audio/wav", b"wav")
    video = _write_asset(state, "00000000-0000-4000-8000-000000000003", "video/mp4", b"mp4")
    document = _write_asset(state, "00000000-0000-4000-8000-000000000004", "application/pdf", b"pdf")
    reader = FileAssetReader(state, tmp_path / "work")
    route = _multimodal_router(reader).route({"text": "看和听", "parts": [
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
    degraded = _multimodal_router(FileAssetReader(state, tmp_path / "work")).route({
        "parts": [{"content": {"image": image}}]
    })
    assert degraded.vision_messages == []
    assert "视觉能力当前不可用" in degraded.semantic_text


def test_legacy_media_degrades_without_forged_asset(tmp_path: Path) -> None:
    route = _multimodal_router(
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


def test_llm_gateway_fails_closed_without_or_for_unknown_provider() -> None:
    with pytest.raises(InferenceException, match="真实 LLM provider"):
        LLMEngine(_model_settings(), None).generate(ModelRequest(
            messages=[ModelMessage(role="user", content="你好")]
        ))

    configured = LLMEngine(_model_settings(), LLMSettings(
        api_type="openai", api_key="test-key", models={"chat": "test-model"}
    ))
    with pytest.raises(InferenceException, match="未知 LLM provider"):
        configured.generate(
            ModelRequest(messages=[ModelMessage(role="user", content="你好")]),
            provider_key="missing/chat",
        )


def test_multimodal_router_accepts_null_items_and_never_sends_audio_to_vision() -> None:
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
    text = router.route({"text": "你好", "modality": ["text"], "items": None})
    assert text.primary_text == "你好" and text.vision_messages == []

    route = router.route({"text": "听一下", "items": [
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
    disabled_route = MultimodalRouter(disabled).route({"items": [
        {"modality": "audio", "semantic": {"text": "准确转写", "resolved": True}}
    ]})
    assert disabled_route.semantic_text == "[语音1] 准确转写"
    assert disabled_route.vision_messages == []
