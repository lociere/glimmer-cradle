"""感知进入 CycleController 唯一主线的端到端验证。"""
from __future__ import annotations

from glimmer_cradle.cognition.cycle import CycleController, GlobalWorkspace
from glimmer_cradle.cognition.cycle.perception_queue import PerceptionEntry, PerceptionEventQueue
from glimmer_cradle.cognition.cycle.providers import PerceptionProvider
from glimmer_cradle.cognition.cycle.volition import WillingnessConfig
from glimmer_cradle.cognition.foundation.config import CognitionConfig
from glimmer_cradle.cognition.experience.recorder import ExperienceRecorder


# ─────────────────────────────── 配置默认值 ───────────────────────────────

def test_cognition_config_defaults() -> None:
    """CognitionConfig 默认值（workspace_capacity / tick interval）。"""
    cfg = CognitionConfig()
    assert cfg.workspace_capacity == 7
    assert cfg.default_tick_interval_ms == 5000


def test_cognition_config_frozen() -> None:
    """配置 frozen=True，运行时不可篡改。"""
    cfg = CognitionConfig()
    import pydantic
    try:
        cfg.workspace_capacity = 99  # type: ignore[misc]
    except (pydantic.ValidationError, TypeError, AttributeError):
        return
    raise AssertionError("CognitionConfig 应当是 frozen")


# ─────────────── 端到端：队列 → loop tick → reply intent ───────────────

async def test_end_to_end_perception_to_intent(tmp_path) -> None:
    """主路径：入队 → CycleController tick → 产出 reply intent。"""
    queue = PerceptionEventQueue(max_size=10)
    queue.put(PerceptionEntry(
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

    from glimmer_cradle.cognition.inference.service import ReasoningResponse

    class _FakeReasoning:
        async def request(self, req, *, tier):
            return ReasoningResponse(text="你好呀，我在", tier_used=tier)

    ws = GlobalWorkspace(capacity=5)
    recorder = ExperienceRecorder(tmp_path)
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
            reasoning=_FakeReasoning(),
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
    finally:
        await recorder.stop()


# ─── 生产接线冒烟：感知 → 循环 → 真实 ReasoningService → Act → action_sink ───
# 不用 _FakeReasoning，而用生产接线（ReasoningService→CloudReasoning→LLMEngine），
# 覆盖容器实际装配的完整自主输出通路（缺的只有 ZMQ 物理线）。Act 推出的
# ActionCommand dict 即内核 ACTION_COMMAND handler 入参，跨进程契约在此对齐。

async def test_smoke_perception_to_action_command_production_wiring(tmp_path) -> None:
    """端到端冒烟：真实 ReasoningService 链路 → Act → action_sink 收到 ActionCommand。

    验证生产装配（非 fake）：
      PerceptionEventQueue → PerceptionProvider → 广播 → Deliberate
        （persona_injector 组 prompt → ReasoningService(cloud) → boundary 校验）
        → _pending_reply → Intend(reply) → Act → action_sink
    action_sink 收到的 dict 形状即内核 ACTION_COMMAND handler 读取的契约。
    """
    from glimmer_cradle.cognition.inference.cloud import CloudReasoning
    from glimmer_cradle.cognition.inference.service import ReasoningService

    # ── stub LLMEngine：记录收到的 prompt，返回固定回复（鸭子类型 .generate）──
    captured: dict = {}

    class _StubLLM:
        def generate(self, llm_request, provider_key=None):
            captured["messages"] = llm_request.messages
            return "今天挺好的，谢谢你问我。"

    # ── stub persona_injector / boundary_validator / activity（cloud 档）──
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
            # cloud_allowed → 走 CloudReasoning（命中 stub LLM），验证真实云链路
            return {"state": "engaged",
                    "policy": {"model_tier": "cloud_allowed", "allows_proactive": True}}

    emitted: list[dict] = []

    async def _sink(cmd: dict) -> None:
        emitted.append(cmd)

    queue = PerceptionEventQueue(max_size=10)
    queue.put(PerceptionEntry(
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

    reasoning = ReasoningService(
        cloud=CloudReasoning(_StubLLM()),  # type: ignore[arg-type]
        local=None,
    )

    ws = GlobalWorkspace(capacity=5)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws,
            providers=[PerceptionProvider(queue)],
            experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            activity_controller=_Activity(),
            reasoning=reasoning,
            persona_injector=_Persona(),
            boundary_validator=_boundary,
            action_sink=_sink,
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    # ── 链路全程走通的证据 ──
    # 1. 队列被 drain
    assert queue.size() == 0
    # 2. cloud 链路命中 stub LLM（persona prompt 进了 system 消息）
    assert "messages" in captured
    roles = {m.role: m.content for m in captured["messages"]}
    assert "月见" in roles["system"]            # persona_injector 的 prompt 流入
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
