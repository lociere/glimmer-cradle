"""感知进入 CycleController 唯一主线的端到端验证。"""
from __future__ import annotations

from glimmer_cradle.cognition.attention import (
    AttentionController as _AttentionController,
)
from glimmer_cradle.cognition.attention import (
    make_attention,
)
from glimmer_cradle.cognition.inference import ModelEvent, ModelEventKind
from glimmer_cradle.cognition.loop import CognitionSettings, WillingnessConfig
from glimmer_cradle.cognition.loop import LoopController as _CycleController
from glimmer_cradle.cognition.loop import PerceptionProvider as _PerceptionProvider
from glimmer_cradle.cognition.perception import (
    Observation,
    ObservationQueue,
    PerceptionOperationRegistry,
)
from tests.conftest import CLOCK, IDS, OBSERVABILITY, build_experience_recorder
from tests.test_cycle_controller import _CloudActivity, _EmptyCapabilities


def AttentionController(*args, **kwargs):
    kwargs.setdefault("clock", CLOCK)
    return _AttentionController(*args, **kwargs)


def PerceptionProvider(*args, **kwargs):
    kwargs.setdefault("clock", CLOCK)
    kwargs.setdefault("ids", IDS)
    return _PerceptionProvider(*args, **kwargs)


def CycleController(*args, **kwargs):
    kwargs.setdefault("clock", CLOCK)
    kwargs.setdefault("ids", IDS)
    kwargs.setdefault("observability", OBSERVABILITY)
    if kwargs.get("native_model") is not None:
        kwargs.setdefault("capability_factory", lambda _: _EmptyCapabilities())
        kwargs.setdefault("activity_controller", _CloudActivity())
    return _CycleController(*args, **kwargs)


# ─────────────────────────────── 配置默认值 ───────────────────────────────

def test_cognition_config_requires_normalized_values() -> None:
    cfg = CognitionSettings(workspace_capacity=7, default_tick_interval_ms=5000)
    assert cfg.workspace_capacity == 7
    assert cfg.default_tick_interval_ms == 5000


def test_cognition_config_frozen() -> None:
    """配置 frozen=True，运行时不可篡改。"""
    cfg = CognitionSettings(workspace_capacity=7, default_tick_interval_ms=5000)
    import pydantic
    try:
        cfg.workspace_capacity = 99  # type: ignore[misc]
    except (pydantic.ValidationError, TypeError, AttributeError):
        return
    raise AssertionError("CognitionSettings 应当是 frozen")


# ─────────────── 端到端：队列 → loop tick → reply intent ───────────────

async def test_end_to_end_perception_to_intent(tmp_path) -> None:
    """主路径：入队 → CycleController tick → 产出 reply intent。"""
    queue = ObservationQueue(max_size=10)
    queue.put(Observation(
        source_provider_id="provider:actual",
        scene_id="napcat:group:1",
        conversation_id="conversation:napcat:group:1",
        continuity_id="continuity:user:1",
        thread_id="main",
        recall_scope="space_local",
        disclosure_scope="space_local",
        address_mode="direct",
        familiarity=8,
        text="你好月见",
        trace_id="trace-1",
    ))

    class _TextModel:
        async def events(self, req):
            yield ModelEvent(0, ModelEventKind.TEXT_DELTA, {"text": "你好呀，我在"})
            yield ModelEvent(1, ModelEventKind.COMPLETED)

    ws = AttentionController(capacity=5)
    recorder = build_experience_recorder(tmp_path)
    await recorder.start()
    try:
        provider = PerceptionProvider(queue)
        # 用低阈值确保过阈（默认 awake=0.4，纯 perception 不一定够）
        cfg = WillingnessConfig(threshold_by_activity={"engaged": 0.2})
        loop = CycleController(
            workspace=ws,
            providers=[provider],
            experience_recorder=recorder,
            willingness_config=cfg,
            native_model=_TextModel(),
        )
        await loop.tick_once()

        # 队列被 drain，仲裁结果有一个 reply intent
        assert queue.size() == 0
        result = loop.last_arbitration
        assert result is not None
        assert len(result.accepted) == 1
        intent = result.accepted[0]
        assert intent.type.value == "reply"
        # 阶段 7.2：回复文本来自 Deliberate 生成（非回显输入）
        assert intent.payload["text"] == "你好呀，我在"
        await recorder.flush()
        perception = next(moment for moment in recorder.iter_moments_since(None) if moment.kind == "perception")
        assert perception.content["source_provider_id"] == "provider:actual"
    finally:
        await recorder.stop()


async def test_ambient_not_selected_is_successful_ingress_without_reply(tmp_path) -> None:
    """正常的环境观察可以不进入广播，但不能反馈为系统失败并触发 Kernel 熔断。"""
    queue = ObservationQueue(max_size=10)
    queue.put(Observation(
        scene_id="napcat:group:1",
        conversation_id="conversation:napcat:group:1",
        continuity_id="continuity:napcat:group:1",
        thread_id="main",
        recall_scope="space_local",
        disclosure_scope="space_local",
        address_mode="ambient",
        response_policy="observe_only",
        familiarity=1,
        text="群聊中的环境消息",
        trace_id="trace-ambient-not-selected",
    ))
    operations = PerceptionOperationRegistry()
    operation, _ = operations.accept(
        "perception:ambient-not-selected",
        "trace-ambient-not-selected",
    )
    workspace = AttentionController(capacity=1)
    await workspace.propose(make_attention(
        source="drive",
        content={"drive": "curiosity", "level": 1.0},
        salience=1.0,
        clock=CLOCK,
        ids=IDS,
    ))
    recorder = build_experience_recorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=workspace,
            providers=[PerceptionProvider(queue)],
            experience_recorder=recorder,
            perception_operations=operations,
        )

        await loop.tick_once()

        assert operation.state == "succeeded"
        assert operation.safe_message == ""
        assert loop.last_arbitration is not None
        assert all(intent.type.value != "reply" for intent in loop.last_arbitration.accepted)
    finally:
        await recorder.stop()


async def test_ambient_accepted_behind_persistent_drive_reaches_terminal_success(tmp_path) -> None:
    """背景感知写入经历后即完成，不因等待未来广播而永久占住 Kernel 入站。"""
    queue = ObservationQueue(max_size=10)
    queue.put(Observation(
        scene_id="napcat:group:1",
        conversation_id="conversation:napcat:group:1",
        continuity_id="continuity:napcat:group:1",
        thread_id="main",
        recall_scope="space_local",
        disclosure_scope="space_local",
        address_mode="ambient",
        response_policy="observe_only",
        familiarity=1,
        text="工作区暂存的环境消息",
        trace_id="trace-ambient-accepted",
    ))
    operations = PerceptionOperationRegistry()
    operation, _ = operations.accept(
        "perception:ambient-accepted", "trace-ambient-accepted"
    )
    workspace = AttentionController(capacity=5)
    await workspace.propose(make_attention(
        source="drive",
        content={"drive": "curiosity", "level": 1.0},
        salience=1.0,
        clock=CLOCK,
        ids=IDS,
    ))
    recorder = build_experience_recorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=workspace,
            providers=[PerceptionProvider(queue)],
            experience_recorder=recorder,
            perception_operations=operations,
        )

        await loop.tick_once()

        assert operation.state == "succeeded"
        assert operation.terminal is True
        assert await workspace.size() == 2
    finally:
        await recorder.stop()


async def test_direct_perception_rejected_by_workspace_is_a_real_failure(tmp_path) -> None:
    """direct 是互动义务；若连工作区都无法接纳，必须报告真实失败。"""
    queue = ObservationQueue(max_size=10)
    queue.put(Observation(
        scene_id="scene-1", conversation_id="conversation-1",
        continuity_id="continuity-1", thread_id="main",
        recall_scope="conversation_private", disclosure_scope="conversation_private",
        address_mode="direct", response_policy="reply_allowed", familiarity=10,
        text="直接呼唤", trace_id="trace-direct-rejected",
    ))
    operations = PerceptionOperationRegistry()
    operation, _ = operations.accept(
        "perception:direct-rejected", "trace-direct-rejected"
    )
    workspace = AttentionController(capacity=1)
    incumbent = make_attention(
        source="perception",
        content={"trace_id": "older-direct", "address_mode": "direct"},
        salience=1.0,
        clock=CLOCK,
        ids=IDS,
    )
    incumbent.created_at = "9999-12-31T23:59:59+00:00"
    await workspace.propose(incumbent)
    recorder = build_experience_recorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=workspace,
            providers=[PerceptionProvider(queue)],
            experience_recorder=recorder,
            perception_operations=operations,
        )
        await loop.tick_once()
        assert operation.state == "failed"
        assert operation.safe_message == "直接感知未进入工作区广播"
    finally:
        await recorder.stop()


async def test_new_input_cancels_real_inference_operation_before_action(tmp_path) -> None:
    """CancelPerception 取消实际 Deliberate task，并留下可查询的受管终态。"""
    import asyncio

    started = asyncio.Event()
    emitted: list[dict] = []

    class _SlowModel:
        async def events(self, req):
            started.set()
            await asyncio.Future()
            yield  # 被取消前不会产生模型事件。

    async def _sink(command: dict) -> None:
        emitted.append(command)

    queue = ObservationQueue(max_size=10)
    queue.put(Observation(
        scene_id="scene-1", conversation_id="conversation-1", continuity_id="continuity-1",
        thread_id="main", recall_scope="conversation_private", disclosure_scope="conversation_private",
        address_mode="direct", familiarity=10, text="first", trace_id="trace-cancel-real",
    ))
    operations = PerceptionOperationRegistry()
    operation, _ = operations.accept("perception:cancel-real", "trace-cancel-real")
    recorder = build_experience_recorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=AttentionController(capacity=5),
            providers=[PerceptionProvider(queue)],
            experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            native_model=_SlowModel(),
            action_sink=_sink,
            perception_operations=operations,
        )
        tick = asyncio.create_task(loop.tick_once())
        await asyncio.wait_for(started.wait(), timeout=1)
        await operations.cancel("trace-cancel-real")
        assert tick.cancelled()
        assert operation.state == "cancelled"
        assert operation.terminal is True
        assert emitted == []
    finally:
        await recorder.stop()


async def test_smoke_perception_to_action_command_model_adapter_wiring(tmp_path) -> None:
    """实际 ModelClient→Loop→Act 接线；provider 用 fixture，不声明 HTTP/跨进程已验证。"""
    from glimmer_cradle.cognition_worker.adapters.model_client import ModelClient

    captured: dict = {}

    class _StubLLM:
        async def stream_native(self, request):
            captured["request"] = request
            yield ModelEvent(0, ModelEventKind.TEXT_DELTA, {"text": "今天挺好的，谢谢你问我。"})
            yield ModelEvent(1, ModelEventKind.COMPLETED)

    # ── stub persona compiler / boundary_validator / activity（cloud 档）──
    persona_calls: list = []

    class _Persona:
        def build_persona_prompt(self, *, emotion_state, address_mode):
            persona_calls.append(address_mode)
            return "你是月见，一个温柔的桌面伴侣。用简短自然的中文回应。"

    boundary_calls: list = []

    def _boundary(text: str) -> bool:
        boundary_calls.append(text)
        return True  # 放行

    class _Activity:
        def get_state(self):
            # 明确允许原生 cloud 路由；没有 local-only 提档。
            return {"state": "engaged",
                    "policy": {"model_tier": "cloud_allowed", "allows_proactive": True}}

    emitted: list[dict] = []

    async def _sink(cmd: dict) -> None:
        emitted.append(cmd)

    queue = ObservationQueue(max_size=10)
    queue.put(Observation(
        scene_id="napcat:group:42",
        conversation_id="conversation:napcat:group:42",
        continuity_id="continuity:user:7",
        thread_id="main",
        recall_scope="space_local",
        disclosure_scope="space_local",
        address_mode="direct",
        familiarity=9,
        text="月见今天过得怎么样？",
        trace_id="trace-smoke-1",
        actor_id="napcat:user:U_7",
        actor_name="Elise",
    ))

    model = ModelClient(_StubLLM())

    ws = AttentionController(capacity=5)
    recorder = build_experience_recorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws,
            providers=[PerceptionProvider(queue)],
            experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            activity_controller=_Activity(),
            native_model=model,
            persona_compiler=_Persona(),
            boundary_validator=_boundary,
            action_sink=_sink,
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    # ── 链路全程走通的证据 ──
    # 1. 队列被 drain
    assert queue.size() == 0
    # 2. 实际 ModelClient 保留 persona、用户与 capability exposure。
    request = captured["request"]
    roles = {"system": request.system, "user": request.user}
    assert request.metadata["capabilities"] == ()
    assert "月见" in roles["system"]            # persona compiler 的 prompt 流入
    assert roles["user"] == "月见今天过得怎么样？"  # 用户原文进 user 消息
    assert persona_calls == ["direct"]           # persona 按 address_mode 调用
    assert boundary_calls == ["今天挺好的，谢谢你问我。"]  # 红线校验生成文本
    # 3. Act 推出的 ActionCommand —— 即内核 ACTION_COMMAND handler 入参契约
    assert len(emitted) == 1
    cmd = emitted[0]
    assert cmd["action_type"] == "reply"
    assert cmd["target"]["scene_id"] == "napcat:group:42"
    assert cmd["payload"]["text"] == "今天挺好的，谢谢你问我。"  # 真实生成文本
    assert cmd["trace_id"] == "trace-smoke-1"     # 原 perception trace 贯通（下游路由键）
def test_perception_queue_reports_the_operation_dropped_by_capacity() -> None:
    queue = ObservationQueue(max_size=1)
    first = Observation(
        scene_id="scene", conversation_id="conversation", continuity_id="continuity",
        thread_id="main", recall_scope="private", disclosure_scope="private",
        address_mode="direct", familiarity=10, text="first", trace_id="trace-first",
    )
    second = Observation(
        scene_id="scene", conversation_id="conversation", continuity_id="continuity",
        thread_id="main", recall_scope="private", disclosure_scope="private",
        address_mode="direct", familiarity=10, text="second", trace_id="trace-second",
    )

    assert queue.put(first) is None
    assert queue.put(second) == first
    assert queue.drain() == [second]
