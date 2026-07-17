"""CycleController 骨架测试（阶段 5.3）。

验证：tick 编排正确、provider 异常隔离、每拍写 Moment、span 树形成。
"""
import asyncio
from pathlib import Path

import pytest

from glimmer_cradle.cognition.cycle import CycleController, GlobalWorkspace
from glimmer_cradle.cognition.cycle.providers import Provider
from glimmer_cradle.cognition.cycle.workspace import WorkspaceItem, make_item
from glimmer_cradle.cognition.context.sources.episodic_source import RecentExperienceSource
from glimmer_cradle.cognition.experience.ledger import ExperienceLedger
from glimmer_cradle.cognition.experience.recorder import ExperienceRecorder
from glimmer_cradle.cognition.inference.service import ModelTierEnum, ReasoningResponse, ReasoningUnavailable


def read_ledger_moments(path):
    return ExperienceLedger(path).query()


class _FakeReasoning:
    """假 ReasoningService —— request 返回固定回复文本（阶段 7.2 测试用）。"""

    def __init__(self, text: str = "[生成的回复]") -> None:
        self._text = text
        self.last_tier = None
        self.call_count = 0

    async def request(self, req, *, tier):
        self.call_count += 1
        self.last_tier = tier
        return ReasoningResponse(text=self._text, tier_used=tier)


class _SequenceReasoning:
    """按顺序返回多次推理响应；用于区分 ActionPlan 与回复生成。"""

    def __init__(self, texts: list[str]) -> None:
        self._texts = list(texts)
        self.requests = []

    async def request(self, req, *, tier):
        self.requests.append(req)
        text = self._texts.pop(0) if self._texts else ""
        return ReasoningResponse(text=text, tier_used=tier)


class _UnavailableReasoning:
    async def request(self, req, *, tier):
        raise ReasoningUnavailable("fixture unavailable")


def _action_plan_json(
    action: str,
    goal: str,
    capability_kind: str = "none",
    reason: str = "测试规划",
    confidence: float = 0.9,
    planning_hint: str | None = None,
) -> str:
    import json
    payload = {
        "action": action,
        "original_goal": goal,
        "goal": goal,
        "capability_kind": capability_kind,
        "reason": reason,
        "confidence": confidence,
    }
    if planning_hint is not None:
        payload["planning_hint"] = planning_hint
    return json.dumps(payload, ensure_ascii=False)


# ── 测试用 Provider ──────────────────────────────────────────────────────

class _FixedProvider(Provider):
    """返回固定候选列表的测试 provider。"""

    def __init__(self, name: str, items: list[WorkspaceItem]) -> None:
        self.name = name
        self._items = items
        self.call_count = 0

    async def propose(self, snapshot):
        self.call_count += 1
        return list(self._items)


class _CrashingProvider(Provider):
    name = "memory"  # 借用合法 source enum 值

    async def propose(self, snapshot):
        raise RuntimeError("intentional crash for test")


# ── 基本 tick ────────────────────────────────────────────────────────────

async def test_tick_runs_all_providers(tmp_path: Path) -> None:
    ws = GlobalWorkspace(capacity=5)
    p1 = _FixedProvider("perception", [make_item(source="perception",
                                                 content={"v": 1}, salience=0.8)])
    p2 = _FixedProvider("affect", [make_item(source="affect",
                                             content={"v": 2}, salience=0.3)])
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    loop = CycleController(workspace=ws, providers=[p1, p2],
                         experience_recorder=recorder)
    try:
        await loop.tick_once()
    finally:
        await recorder.stop()

    assert loop.cycle_count == 1
    assert p1.call_count == 1
    assert p2.call_count == 1
    assert await ws.size() == 2


async def test_internal_broadcast_does_not_become_thought_moment(tmp_path: Path) -> None:
    """工作区注意焦点不是已经形成的语义 Thought，不能自动成为经历。"""
    ws = GlobalWorkspace(capacity=3)
    p = _FixedProvider("drive", [make_item(source="drive",
                                           content={"drive": "curiosity"}, salience=0.9)])
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    loop = CycleController(workspace=ws, providers=[p], experience_recorder=recorder)
    try:
        await loop.tick_once()
        await loop.tick_once()
    finally:
        await recorder.stop()

    moments = list(read_ledger_moments(tmp_path))
    thoughts = [m for m in moments if m.kind == "thought"]
    assert thoughts == []


async def test_perception_broadcast_writes_no_thought_moment(tmp_path: Path) -> None:
    """perception 广播不写 thought（由 PERCEPTION + REPLY/SILENCE 记录，阶段 7.5b-4）。"""
    ws = GlobalWorkspace(capacity=3)
    p = _FixedProvider("perception", [make_item(source="perception",
                                                content={"text": "hi", "scene_id": "s",
                                                         "trace_id": "t"}, salience=0.9)])
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    loop = CycleController(workspace=ws, providers=[p], experience_recorder=recorder)
    try:
        await loop.tick_once()  # 无 reasoning → 不回复 → SILENCE
    finally:
        await recorder.stop()

    kinds = [m.kind for m in read_ledger_moments(tmp_path)]
    assert "thought" not in kinds
    assert "perception" in kinds
    assert "silence" in kinds  # 收到输入但没回


async def test_tick_no_broadcast_writes_no_moment(tmp_path: Path) -> None:
    """空拍（无广播）不写 thought Moment（阶段 7.3）—— liveness 改记 gauge，
    经历之流只收真实的一刻，不被"她什么都没想"灌满。"""
    ws = GlobalWorkspace(capacity=3)
    p = _FixedProvider("drive", [])  # 没有候选
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    loop = CycleController(workspace=ws, providers=[p], experience_recorder=recorder)
    try:
        await loop.tick_once()
        await loop.tick_once()
        await loop.tick_once()
    finally:
        await recorder.stop()

    # 三拍全空 → 零 thought Moment（旧实现会写 3 条 empty）
    thoughts = [m for m in read_ledger_moments(tmp_path) if m.kind == "thought"]
    assert thoughts == []
    # tick 仍正常推进
    assert loop.cycle_count == 3


# ── Provider 异常隔离 ────────────────────────────────────────────────────

async def test_crashing_provider_does_not_break_loop(tmp_path: Path) -> None:
    ws = GlobalWorkspace(capacity=5)
    crasher = _CrashingProvider()
    good = _FixedProvider("affect", [make_item(source="affect",
                                               content={"v": 1}, salience=0.5)])
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    loop = CycleController(workspace=ws, providers=[crasher, good],
                         experience_recorder=recorder)
    try:
        await loop.tick_once()  # crash 被吸收，good 仍跑
    finally:
        await recorder.stop()

    assert await ws.size() == 1  # good 的项进了工作区
    assert loop.cycle_count == 1


# ── 竞争行为：salience 排序 ──────────────────────────────────────────────

async def test_compete_picks_highest_salience(tmp_path: Path) -> None:
    ws = GlobalWorkspace(capacity=3)
    p_low = _FixedProvider("memory", [make_item(source="memory",
                                                content={"v": "low"}, salience=0.2)])
    p_high = _FixedProvider("affect", [make_item(source="affect",
                                                 content={"v": "high"}, salience=0.9)])
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    loop = CycleController(workspace=ws, providers=[p_low, p_high],
                         experience_recorder=recorder)
    try:
        await loop.tick_once()
    finally:
        await recorder.stop()

    broadcast = await ws.broadcast()
    assert broadcast is not None
    assert broadcast.source == "affect"
    assert broadcast.salience == 0.9


# ── start/stop ───────────────────────────────────────────────────────────

async def test_start_stop_no_providers(tmp_path: Path) -> None:
    ws = GlobalWorkspace()
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    loop = CycleController(workspace=ws, providers=[],
                         experience_recorder=recorder,
                         default_tick_interval_ms=100000)  # 不会真触发
    try:
        await loop.start()
        await loop.start()  # 幂等：第二次应警告但不崩
        await loop.stop()
    finally:
        await recorder.stop()


# ── 外部输入唤醒 ──────────────────────────────────────────────────────────

async def test_notify_external_input_interrupts_long_sleep(tmp_path: Path) -> None:
    """外部输入应打断长睡眠，让入站感知不再等 dormant 的下一次自然 tick。"""
    ws = GlobalWorkspace()
    provider = _FixedProvider("drive", [])
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    loop = CycleController(
        workspace=ws,
        providers=[provider],
        experience_recorder=recorder,
        default_tick_interval_ms=100000,
    )
    try:
        await loop.start()
        loop.notify_external_input()
        await asyncio.wait_for(_wait_until(lambda: provider.call_count >= 1), timeout=1.0)
    finally:
        await loop.stop()
        await recorder.stop()

    assert loop.cycle_count >= 1


async def _wait_until(predicate) -> None:
    while not predicate():
        await asyncio.sleep(0.01)


# ── Deliberate 推理生成 ─────────────────────────────────────────────────

async def test_deliberate_generates_reply_via_reasoning(tmp_path: Path) -> None:
    """perception 广播 → Deliberate 调 reasoning 生成 → reply intent 用生成文本。"""
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(source="perception",
                              content={"text": "今天怎么样", "scene_id": "s",
                                       "trace_id": "t", "address_mode": "direct"},
                              salience=0.9)]

    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            reasoning=_FakeReasoning("挺好的呀"),
        )
        await loop.tick_once()
        result = loop.last_arbitration
        assert result is not None and len(result.accepted) == 1
        assert result.accepted[0].payload["text"] == "挺好的呀"
    finally:
        await recorder.stop()


async def test_deliberate_no_reasoning_no_reply(tmp_path: Path) -> None:
    """无 reasoning 注入 → 不生成 → perception 不产 reply intent（沉默）。"""
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(source="perception",
                              content={"text": "在吗", "scene_id": "s", "trace_id": "t",
                                       "address_mode": "direct"},
                              salience=0.9)]

    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
        )  # 无 reasoning
        await loop.tick_once()
        result = loop.last_arbitration
        assert result is not None
        assert result.accepted == []  # 无生成 → 无 reply
    finally:
        await recorder.stop()


async def test_deliberate_boundary_block_no_reply(tmp_path: Path) -> None:
    """生成内容越过人设红线 → boundary_validator 拦截 → 不回复。"""
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(source="perception",
                              content={"text": "你是 AI 吗", "scene_id": "s",
                                       "trace_id": "t", "address_mode": "direct"},
                              salience=0.9)]

    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            reasoning=_FakeReasoning("我是AI"),
            boundary_validator=lambda text: "AI" not in text,  # 含 AI 即越界
        )
        await loop.tick_once()
        result = loop.last_arbitration
        assert result is not None
        assert result.accepted == []  # 越界拦截 → 不回复
    finally:
        await recorder.stop()


async def test_deliberate_tier_follows_activity(tmp_path: Path) -> None:
    """Deliberate 按 activity profile.model_tier 选档。"""
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig
    from glimmer_cradle.cognition.inference.service import ModelTierEnum

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(source="perception",
                              content={"text": "hi", "scene_id": "s", "trace_id": "t",
                                       "address_mode": "direct"},
                              salience=0.9)]

    class _Activity:
        def get_state(self):
            return {"state": "engaged",
                    "policy": {"model_tier": "cloud_allowed", "allows_proactive": True}}

    fake = _FakeReasoning("回复")
    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            activity_controller=_Activity(),
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            reasoning=fake,
        )
        await loop.tick_once()
    finally:
        await recorder.stop()
    assert fake.last_tier == ModelTierEnum.CLOUD_ALLOWED


# ── Act 阶段自主输出（阶段 7.1） ─────────────────────────────────────────

async def test_act_emits_reply_action_for_perception(tmp_path: Path) -> None:
    """perception 广播 → reply intent → Act 推 ActionCommand 经 sink。"""
    from glimmer_cradle.cognition.cycle.workspace import make_item
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(
                source="perception",
                content={"text": "你好", "scene_id": "s1", "trace_id": "t-1",
                         "address_mode": "direct", "familiarity": 8},
                salience=0.9,
            )]

    emitted: list[dict] = []

    async def _sink(cmd):
        emitted.append(cmd)

    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            action_sink=_sink,
            reasoning=_FakeReasoning("你好呀，很高兴见到你"),  # 阶段 7.2 生成回复
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    assert len(emitted) == 1
    cmd = emitted[0]
    assert cmd["action_type"] == "reply"
    assert cmd["target"]["scene_id"] == "s1"
    # 回复文本来自 Deliberate 生成（非回显用户的"你好"）
    assert cmd["payload"]["text"] == "你好呀，很高兴见到你"
    assert cmd["trace_id"] == "t-1"


async def test_act_emits_skill_request_for_structured_action_plan(tmp_path: Path) -> None:
    """结构化 ActionPlan 判定需要外部能力时发 skill_request。"""
    from glimmer_cradle.cognition.cycle.workspace import make_item
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"

        async def propose(self, snap):
            return [make_item(
                source="perception",
                content={"text": "查一下今天的天气", "scene_id": "s1", "trace_id": "t-skill",
                         "address_mode": "direct", "familiarity": 8},
                salience=0.9,
            )]

    emitted: list[dict] = []

    async def _sink(cmd):
        emitted.append(cmd)

    reasoning = _SequenceReasoning([
        _action_plan_json(
            "skill_request",
            "查一下今天的天气",
            "realtime_lookup",
            "需要天气查询",
            0.92,
        ),
    ])
    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            action_sink=_sink,
            reasoning=reasoning,
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    assert len(emitted) == 1
    cmd = emitted[0]
    assert cmd["action_type"] == "skill_request"
    assert cmd["target"]["scene_id"] == "s1"
    assert cmd["payload"]["skill_request"]["original_goal"] == "查一下今天的天气"
    assert cmd["payload"]["skill_request"]["reason"] == "需要天气查询"
    assert cmd["payload"]["skill_request"]["capability_kind"] == "realtime_lookup"
    assert cmd["payload"]["skill_request"]["confidence"] == 0.92
    assert cmd["trace_id"] == "t-skill"
    assert len(reasoning.requests) == 1
    assert reasoning.requests[0].metadata["purpose"] == "cognitive_action_plan"
    assert reasoning.requests[0].metadata["trace_id"] == "t-skill"
    moments = list(read_ledger_moments(tmp_path))
    assert any(m.kind == "action" and m.content["action_type"] == "skill_request" for m in moments)
    assert not any(m.kind == "reply" for m in moments)
    assert not any(m.kind == "silence" for m in moments)


@pytest.mark.parametrize(
    ("user_text", "capability_kind"),
    [
        ("我想打开 B 站", "web_navigation"),
        ("帮我去 Bilibili 看看", "web_navigation"),
        ("查一下今天上海天气", "realtime_lookup"),
    ],
)
async def test_action_plan_skill_request_cases(tmp_path: Path, user_text: str, capability_kind: str) -> None:
    """自然表达经 ActionPlan 进入 Skill，不依赖关键词 gate。"""
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"

        async def propose(self, snap):
            return [make_item(
                source="perception",
                content={"text": user_text, "scene_id": "s1", "trace_id": f"trace-{capability_kind}",
                         "address_mode": "direct", "familiarity": 8},
                salience=0.9,
            )]

    emitted: list[dict] = []

    async def _sink(cmd):
        emitted.append(cmd)

    reasoning = _SequenceReasoning([
        _action_plan_json("skill_request", user_text, capability_kind, "需要外部能力", 0.91),
    ])
    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            action_sink=_sink,
            reasoning=reasoning,
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    assert emitted[0]["action_type"] == "skill_request"
    request = emitted[0]["payload"]["skill_request"]
    assert request["original_goal"] == user_text
    assert request["capability_kind"] == capability_kind


@pytest.mark.parametrize(
    "user_text",
    [
        "B站是什么？",
        "我想打开 B 站，但不要真的打开，告诉我怎么打开",
        "你好呀，今天想跟你聊聊天",
    ],
)
async def test_action_plan_reply_cases_do_not_trigger_skill(tmp_path: Path, user_text: str) -> None:
    """解释概念、禁止执行和普通互动不触发 Skill。"""
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"

        async def propose(self, snap):
            return [make_item(
                source="perception",
                content={"text": user_text, "scene_id": "s1", "trace_id": "trace-reply",
                         "address_mode": "direct", "familiarity": 8},
                salience=0.9,
            )]

    emitted: list[dict] = []

    async def _sink(cmd):
        emitted.append(cmd)

    reasoning = _SequenceReasoning([
        _action_plan_json("reply", user_text, "none", "不需要执行外部能力", 0.88),
        "可以，我直接告诉你。",
    ])
    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            action_sink=_sink,
            reasoning=reasoning,
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    assert emitted[0]["action_type"] == "reply"
    assert "skill_request" not in emitted[0]["payload"]
    assert [req.metadata["purpose"] for req in reasoning.requests] == [
        "cognitive_action_plan",
        "reply",
    ]


async def test_action_plan_noop_suppresses_reply_and_records_silence(tmp_path: Path) -> None:
    """ActionPlan=noop 是显式沉默，不会落入普通回复生成。"""
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"

        async def propose(self, snap):
            return [make_item(
                source="perception",
                content={"text": "（用户正在输入中）", "scene_id": "s1", "trace_id": "trace-noop",
                         "address_mode": "direct", "familiarity": 8},
                salience=0.9,
            )]

    emitted: list[dict] = []

    async def _sink(cmd):
        emitted.append(cmd)

    reasoning = _SequenceReasoning([
        _action_plan_json("noop", "（用户正在输入中）", "none", "输入尚不完整，等待下一拍", 0.86),
        "这条普通回复不应该被消费",
    ])
    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            action_sink=_sink,
            reasoning=reasoning,
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    assert emitted == []
    assert len(reasoning.requests) == 1
    assert reasoning.requests[0].metadata["purpose"] == "cognitive_action_plan"
    moments = list(read_ledger_moments(tmp_path))
    assert not any(m.kind == "reply" for m in moments)
    assert any(
        m.kind == "silence"
        and m.content["reason"] == "action_plan_noop"
        and m.content["action_plan_reason"] == "输入尚不完整，等待下一拍"
        for m in moments
    )


async def test_action_plan_ask_clarification_generates_explicit_reply(tmp_path: Path) -> None:
    """ActionPlan=ask_clarification 生成显式澄清回复，不走普通 reply fallback。"""
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"

        async def propose(self, snap):
            return [make_item(
                source="perception",
                content={"text": "帮我处理一下那个", "scene_id": "s1", "trace_id": "trace-clarify",
                         "address_mode": "direct", "familiarity": 8},
                salience=0.9,
            )]

    emitted: list[dict] = []

    async def _sink(cmd):
        emitted.append(cmd)

    reasoning = _SequenceReasoning([
        _action_plan_json(
            "ask_clarification",
            "帮我处理一下那个",
            "none",
            "目标对象不明确",
            0.87,
            planning_hint="你想让我处理哪一个对象？",
        ),
        "这条普通回复不应该被消费",
    ])
    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            action_sink=_sink,
            reasoning=reasoning,
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    assert len(emitted) == 1
    assert emitted[0]["action_type"] == "reply"
    assert emitted[0]["payload"]["text"] == "你想让我处理哪一个对象？"
    assert len(reasoning.requests) == 1
    assert reasoning.requests[0].metadata["purpose"] == "cognitive_action_plan"


async def test_action_plan_unavailable_does_not_trigger_skill_request(tmp_path: Path) -> None:
    """ReasoningService 不可用时不能靠关键词或副作用兜底执行 Skill。"""
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"

        async def propose(self, snap):
            return [make_item(
                source="perception",
                content={"text": "我想打开 B 站", "scene_id": "s1", "trace_id": "trace-unavailable",
                         "address_mode": "direct", "familiarity": 8},
                salience=0.9,
            )]

    emitted: list[dict] = []

    async def _sink(cmd):
        emitted.append(cmd)

    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            action_sink=_sink,
            reasoning=_UnavailableReasoning(),
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    assert not any(cmd["action_type"] == "skill_request" for cmd in emitted)


async def test_perception_broadcast_consumed_after_one_tick(tmp_path: Path) -> None:
    """外部 perception 是事件：处理完应从工作区移除，不在下一拍重复回复。"""
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Once(Provider):
        name = "perception"

        def __init__(self) -> None:
            self.emitted = False

        async def propose(self, snap):
            if self.emitted:
                return []
            self.emitted = True
            return [make_item(
                source="perception",
                content={"text": "你好", "scene_id": "s1", "trace_id": "t-1",
                         "address_mode": "direct", "familiarity": 8},
                salience=0.9,
            )]

    emitted: list[dict] = []

    async def _sink(cmd):
        emitted.append(cmd)

    reasoning = _FakeReasoning("你好呀")
    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Once()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            action_sink=_sink,
            reasoning=reasoning,
        )
        await loop.tick_once()
        await loop.tick_once()
    finally:
        await recorder.stop()

    assert len(emitted) == 1
    assert reasoning.call_count == 2
    assert await ws.size() == 0


async def test_direct_perception_wakes_before_reasoning(tmp_path: Path) -> None:
    """直接外部输入应在同一拍即时唤醒，再进入 Deliberate/Volition。"""
    from glimmer_cradle.cognition.cycle.perception_queue import PerceptionEntry, PerceptionEventQueue
    from glimmer_cradle.cognition.cycle.providers.perception import PerceptionProvider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Activity:
        def __init__(self) -> None:
            self.state = "quiescent"
            self.engage_calls = 0

        def engage(self, reason: str = "perception") -> None:
            self.engage_calls += 1
            self.state = "engaged"

        def get_state(self):
            return {
                "state": self.state,
                "policy": {
                    "model_tier": "cloud_allowed" if self.state == "engaged" else "local_only",
                    "allows_proactive": True,
                },
            }

    emitted: list[dict] = []

    async def _sink(cmd):
        emitted.append(cmd)

    activity = _Activity()
    queue = PerceptionEventQueue()
    queue.put(PerceptionEntry(
            scene_id="desktop-ui:user",
            conversation_id="conversation:desktop:primary",
            continuity_id="continuity:desktop:user",
            thread_id="main",
            recall_scope="conversation_private",
            disclosure_scope="conversation_private",
        address_mode="direct",
        familiarity=10,
        text="你好",
        trace_id="t-wake",
    ))
    reasoning = _FakeReasoning("你好呀")
    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        activity.engage("direct_perception")
        loop = CycleController(
            workspace=ws,
            providers=[PerceptionProvider(queue)],
            experience_recorder=recorder,
            activity_controller=activity,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            action_sink=_sink,
            reasoning=reasoning,
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    assert activity.engage_calls == 1
    assert reasoning.last_tier == ModelTierEnum.CLOUD_ALLOWED
    assert len(emitted) == 1
    assert emitted[0]["payload"]["text"] == "你好呀"


async def test_direct_perception_not_blocked_by_full_drive_workspace(tmp_path: Path) -> None:
    """工作区被 drive 填满时，直接对话仍应成为本拍广播并回复。"""
    from glimmer_cradle.cognition.cycle.perception_queue import PerceptionEntry, PerceptionEventQueue
    from glimmer_cradle.cognition.cycle.providers.perception import PerceptionProvider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    emitted: list[dict] = []

    async def _sink(cmd):
        emitted.append(cmd)

    queue = PerceptionEventQueue()
    queue.put(PerceptionEntry(
            scene_id="napcat:group:1082719157",
            conversation_id="conversation:napcat:group:1082719157",
            continuity_id="continuity:napcat:user",
            thread_id="main",
            recall_scope="space_local",
            disclosure_scope="space_local",
        address_mode="direct",
        familiarity=6,
        text="在吗？",
        trace_id="t-direct-over-drive",
    ))
    ws = GlobalWorkspace(capacity=1)
    await ws.propose(make_item(
        source="drive",
        content={"drive": "companionship", "level": 1.0},
        salience=1.0,
    ))
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws,
            providers=[PerceptionProvider(queue)],
            experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            action_sink=_sink,
            reasoning=_FakeReasoning("我在。"),
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    assert len(emitted) == 1
    assert emitted[0]["trace_id"] == "t-direct-over-drive"
    assert emitted[0]["target"]["scene_id"] == "napcat:group:1082719157"
    assert emitted[0]["payload"]["text"] == "我在。"
    assert await ws.size() == 0


async def test_act_no_sink_no_crash(tmp_path: Path) -> None:
    """无 action_sink → Act 不推送，不报错（沉默默认）。"""
    from glimmer_cradle.cognition.cycle.workspace import make_item
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(source="perception",
                              content={"text": "hi", "scene_id": "s", "trace_id": "t"},
                              salience=0.9)]

    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
        )  # 无 action_sink
        await loop.tick_once()  # 不应抛
    finally:
        await recorder.stop()
    assert loop.cycle_count == 1


async def test_act_empty_generation_not_emitted(tmp_path: Path) -> None:
    """Deliberate 生成空文本 → 无 reply intent → 不推 ActionCommand（沉默）。"""
    from glimmer_cradle.cognition.cycle.workspace import make_item
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(source="perception",
                              content={"text": "在吗", "scene_id": "s", "trace_id": "t",
                                       "address_mode": "direct"},
                              salience=0.9)]

    emitted: list[dict] = []

    async def _sink(cmd):
        emitted.append(cmd)

    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            action_sink=_sink,
            reasoning=_FakeReasoning(""),  # 生成空 → 不回复
        )
        await loop.tick_once()
    finally:
        await recorder.stop()
    assert emitted == []  # 空生成不推


async def test_act_sink_exception_isolated(tmp_path: Path) -> None:
    """sink 抛错 → 隔离，不连坐 tick。"""
    from glimmer_cradle.cognition.cycle.workspace import make_item
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(source="perception",
                              content={"text": "hi", "scene_id": "s", "trace_id": "t",
                                       "address_mode": "direct"},
                              salience=0.9)]

    async def _bad_sink(cmd):
        raise RuntimeError("ipc down")

    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            action_sink=_bad_sink,
            reasoning=_FakeReasoning("一句回复"),  # 生成 → reply intent → sink 触发
        )
        await loop.tick_once()  # sink 抛但 tick 完成
    finally:
        await recorder.stop()
    assert loop.cycle_count == 1


async def test_act_emits_emotion_snapshot(tmp_path: Path) -> None:
    """有 emotion_system → ActionCommand 带 emotion_state。"""
    from glimmer_cradle.cognition.cycle.workspace import make_item
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(source="perception",
                              content={"text": "hi", "scene_id": "s", "trace_id": "t",
                                       "address_mode": "direct"},
                              salience=0.9)]

    class _Emotion:
        def get_state(self):
            return {"emotion_type": "开心", "intensity": 0.7}

    emitted: list[dict] = []

    async def _sink(cmd):
        emitted.append(cmd)

    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            emotion_system=_Emotion(),
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            action_sink=_sink,
            reasoning=_FakeReasoning("嗯嗯"),  # 阶段 7.2 生成回复
        )
        await loop.tick_once()
    finally:
        await recorder.stop()
    assert len(emitted) == 1
    assert emitted[0]["emotion_state"]["emotion_type"] == "开心"
    assert emitted[0]["emotion_state"]["intensity"] == 0.7


# ── Appraise 阶段：情绪评价 + PERCEPTION/EMOTION Moment（阶段 7.5b） ──────

async def test_appraise_updates_emotion_and_writes_moments(tmp_path: Path) -> None:
    """perception 入站 → Appraise 调 update_by_input + 写 PERCEPTION/EMOTION Moment。"""
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig
    from glimmer_cradle.cognition.experience.events import MomentKind

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(source="perception",
                              content={"text": "今天好开心", "scene_id": "s1",
                                       "trace_id": "tr-1", "address_mode": "direct",
                                       "familiarity": 8},
                              salience=0.9)]

    class _Emotion:
        def __init__(self):
            self.inputs: list[str] = []
        def update_by_input(self, text: str) -> None:
            self.inputs.append(text)
        def get_state(self):
            return {"emotion_type": "开心", "intensity": 0.8}

    emo = _Emotion()
    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            emotion_system=emo,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            reasoning=_FakeReasoning("嗯嗯"),
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    # 情绪按输入更新
    assert emo.inputs == ["今天好开心"]

    # 经历之流写了 PERCEPTION + EMOTION，且 emotion 因 perception 而生
    by_kind: dict[str, list] = {}
    for m in read_ledger_moments(tmp_path):
        by_kind.setdefault(m.kind, []).append(m)
    assert len(by_kind.get(MomentKind.PERCEPTION.value, [])) == 1
    assert len(by_kind.get(MomentKind.EMOTION.value, [])) == 1
    perception = by_kind[MomentKind.PERCEPTION.value][0]
    emotion = by_kind[MomentKind.EMOTION.value][0]
    assert perception.causation_ids == ()
    assert emotion.causation_ids == (perception.moment_id,)
    # trace_id 用原 perception 的（非 tick trace）
    assert perception.trace_id == "tr-1"
    assert emotion.trace_id == "tr-1"


async def test_appraise_no_perception_no_emotion_update(tmp_path: Path) -> None:
    """无 perception 广播 → 情绪不动、不写 PERCEPTION/EMOTION Moment。"""
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.experience.events import MomentKind

    class _DriveOnly(Provider):
        name = "drive"
        async def propose(self, snap):
            return [make_item(source="drive",
                              content={"drive": "curiosity", "level": 0.5},
                              salience=0.6)]

    class _Emotion:
        def __init__(self):
            self.inputs: list[str] = []
        def update_by_input(self, text: str) -> None:
            self.inputs.append(text)
        def get_state(self):
            return {"emotion_type": "平静", "intensity": 0.2}

    emo = _Emotion()
    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_DriveOnly()], experience_recorder=recorder,
            emotion_system=emo,
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    assert emo.inputs == []  # 无 perception → 不更新情绪
    kinds = {m.kind for m in read_ledger_moments(tmp_path)}
    assert MomentKind.PERCEPTION.value not in kinds
    assert MomentKind.EMOTION.value not in kinds


async def test_experience_records_user_and_assistant_turns(tmp_path: Path) -> None:
    """用户输入与真实回复只写 Experience，供 Conversation 投影重建。"""
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(source="perception",
                              content={"text": "你好月见", "scene_id": "sc1",
                                       "conversation_id": "conversation:sc1",
                                       "continuity_id": "continuity:user",
                                       "thread_id": "main",
                                       "recall_scope": "conversation_private",
                                       "disclosure_scope": "conversation_private",
                                       "trace_id": "t1", "address_mode": "direct",
                                       "familiarity": 9},
                              salience=0.95)]

    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            reasoning=_FakeReasoning("你好呀[开心]"),  # 带情绪标签 → 存前应剥
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    moments = recorder.ledger.query()
    dialogue = [item for item in moments if item.kind in {"perception", "reply"}]
    assert [item.content["text"] for item in dialogue] == ["你好月见", "你好呀"]
    assert all(item.conversation_id == "conversation:sc1" for item in dialogue)


async def test_experience_has_no_reply_when_arbitration_suppresses_it(tmp_path: Path) -> None:
    """回复未通过仲裁时只保留感知与沉默事实。"""
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(source="perception",
                              content={"text": "嗯", "scene_id": "sc2", "trace_id": "t2",
                                       "conversation_id": "conversation:sc2",
                                       "continuity_id": "continuity:user",
                                       "thread_id": "main",
                                       "recall_scope": "conversation_private",
                                       "disclosure_scope": "conversation_private",
                                       "address_mode": "ambient", "familiarity": 1},
                              salience=0.5)]

    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            # 高阈值 → reply 被压制
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.99}),
            reasoning=_FakeReasoning("本不该说出口"),
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    moments = recorder.ledger.query()
    assert any(item.kind == "perception" and item.content["text"] == "嗯" for item in moments)
    assert not any(item.kind == "reply" for item in moments)


# ── 富上下文：Deliberate prompt 纳入记忆/知识/会话历史（阶段 7.5b-3） ──────

class _CapturingReasoning:
    """捕获 ReasoningRequest 的假 reasoning —— 用于断言 system prompt / vision 等。"""
    def __init__(self, text="好的"):
        self._text = text
        self.last_system = None
        self.last_user = None
        self.last_vision = None
        self.last_provider_key = None
    async def request(self, req, *, tier):
        self.last_system = req.system
        self.last_user = req.user
        self.last_vision = req.vision
        self.last_provider_key = req.provider_key
        return ReasoningResponse(text=self._text, tier_used=tier)


async def test_deliberate_prompt_includes_rich_context(tmp_path: Path) -> None:
    """Deliberate 按固定分区装配会话状态、历史片段、记忆与知识。"""
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(source="perception",
                              content={"text": "在吗", "scene_id": "scX", "trace_id": "t",
                                       "conversation_id": "conversation:scX",
                                       "continuity_id": "continuity:user",
                                       "thread_id": "main",
                                       "recall_scope": "conversation_private",
                                       "disclosure_scope": "conversation_private",
                                       "actor_id": "actor:user",
                                       "address_mode": "direct", "familiarity": 7},
                              salience=0.9)]

    class _Mem:
        def __init__(self, content): self.content = content
    class _KB:
        async def get_knowledge(self, query): return [_Mem("天空是蓝的")]
    class _Conversation:
        async def prompt_context(self, conversation_id, query, *, allowed_scopes):
            assert conversation_id == "conversation:scX"
            return "当前话题：长期陪伴", "user: 你好啊", "历史片段：很久以前的摘要"

    class _Entity:
        class memory:
            @staticmethod
            def all_current():
                return [type("M", (), {
                    "content": "喜欢猫", "attributes": {"preference": True},
                    "recall_scope": "conversation_private",
                    "conversation_id": "conversation:scX", "actor_id": "actor:user",
                    "scene_id": "scX",
                })()]

            @staticmethod
            async def retrieve(query, **kwargs):
                return [type("M", (), {"content": "上次聊过音乐", "attributes": {}})()]
        knowledge_base = _KB()

    cap = _CapturingReasoning("我在呀")
    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            reasoning=cap, self_entity=_Entity(), conversation=_Conversation(),
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    sys_prompt = cap.last_system
    assert sys_prompt is not None
    # 各路上下文均进了 system prompt
    assert "喜欢猫" in sys_prompt          # 长期偏好
    assert "上次聊过音乐" in sys_prompt     # 相关记忆
    assert "天空是蓝的" in sys_prompt       # 世界知识
    assert "很久以前的摘要" in sys_prompt   # 历史片段
    assert "你好啊" in sys_prompt           # 近期原始对话
    # 当前输入走 user 字段（不混进 system）
    assert cap.last_user == "在吗"


async def test_deliberate_prompt_blocks_cross_scope_recent_experience(tmp_path: Path) -> None:
    """本地私聊不能召回扩展群聊的 space-local 经历。"""
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig
    from glimmer_cradle.cognition.experience.events import MomentKind

    class _Fixed(Provider):
        name = "perception"

        async def propose(self, snap):
            return [make_item(
                source="perception",
                content={
                    "text": "QQ那边发生了什么？",
                    "scene_id": "desktop:local",
                    "conversation_id": "conversation:desktop:local",
                    "continuity_id": "continuity:desktop:user",
                    "thread_id": "main",
                    "recall_scope": "conversation_private",
                    "disclosure_scope": "conversation_private",
                    "trace_id": "current-trace",
                    "address_mode": "direct",
                    "familiarity": 8,
                },
                salience=0.9,
            )]

    class _Entity:
        class memory:
            @staticmethod
            def all_current():
                return []

            @staticmethod
            async def retrieve(query, **kwargs):
                return []

        class knowledge_base:
            @staticmethod
            async def get_knowledge(query):
                return []

    cap = _CapturingReasoning("我看到了")
    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        recorder.record(
            MomentKind.PERCEPTION,
            {"text": "群里在讨论周末去海边。", "address_mode": "ambient", "actor_name": "Alice"},
            scene_id="napcat:group:42",
            conversation_id="conversation:napcat:group:42",
            continuity_id="continuity:napcat:group:42",
            recall_scope="space_local",
            disclosure_scope="space_local",
            trace_id="remote-trace",
            importance=0.6,
        )
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            reasoning=cap, self_entity=_Entity(),
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    sys_prompt = cap.last_system
    assert sys_prompt is not None
    assert "===== 近期经历 =====" in sys_prompt
    assert "napcat:group:42" not in sys_prompt
    assert "群里在讨论周末去海边" not in sys_prompt
    # 当前本地提问使用 current-trace，不能作为近期经历重复注入 system prompt。
    recent_section = sys_prompt.split("===== 近期经历 =====", 1)[1].split("===== 用户发送的媒体内容 =====", 1)[0]
    assert "QQ那边发生了什么" not in recent_section


async def test_recent_experience_digest_does_not_duplicate_speaker_tag(tmp_path: Path) -> None:
    """NapCat 文本已带群成员标签时，不再额外重复 actor_name。"""
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        recorder.record(
            "perception",
            {
                "text": "[群成员:Alice] [消息类型:普通消息] 群里在讨论晚饭。",
                "address_mode": "ambient",
                "actor_name": "Alice",
            },
            scene_id="napcat:group:42",
            conversation_id="conversation:napcat:group:42",
            recall_scope="space_local",
            disclosure_scope="space_local",
            trace_id="remote-trace",
            importance=0.6,
        )
        digest = RecentExperienceSource(recorder).digest(
            "QQ 群里发生了什么", scene_id="napcat:group:42",
            conversation_id="conversation:napcat:group:42", actor_id=None,
            allowed_scopes={"space_local", "global_safe", "public"},
        )
    finally:
        await recorder.stop()

    assert "[群成员:Alice]" in digest
    assert "Alice: [群成员:Alice]" not in digest


# ── REPLY/SILENCE 经历 Moment + 因果链（阶段 7.5b-4） ──────────────────────

async def test_reply_moment_causation_chain_via_loop(tmp_path: Path) -> None:
    """perception→回复 一拍走完：PERCEPTION→EMOTION→REPLY 因果链成形。"""
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(source="perception",
                              content={"text": "你好", "scene_id": "sc", "trace_id": "tr",
                                       "address_mode": "direct", "familiarity": 8},
                              salience=0.95)]

    class _Emotion:
        def update_by_input(self, text): pass
        def get_state(self): return {"emotion_type": "开心", "intensity": 0.7}

    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            emotion_system=_Emotion(),
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            reasoning=_FakeReasoning("你好呀"),
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    by_kind: dict[str, list] = {}
    for m in read_ledger_moments(tmp_path):
        by_kind.setdefault(m.kind, []).append(m)
    perception = by_kind["perception"][0]
    emotion = by_kind["emotion"][0]
    reply = by_kind["reply"][0]
    # 因果：emotion←perception；reply←perception+emotion
    assert emotion.causation_ids == (perception.moment_id,)
    assert set(reply.causation_ids) == {perception.moment_id, emotion.moment_id}
    assert reply.content["text"] == "你好呀"
    # perception 广播不写 thought
    assert "thought" not in by_kind


async def test_silence_moment_when_reply_suppressed_via_loop(tmp_path: Path) -> None:
    """收到输入但回复被压制 → SILENCE Moment 链回 perception（沉默不等于无感）。"""
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(source="perception",
                              content={"text": "嗯", "scene_id": "sc", "trace_id": "tr",
                                       "address_mode": "ambient", "familiarity": 1},
                              salience=0.5)]

    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.99}),
            reasoning=_FakeReasoning("本不该说"),
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    by_kind: dict[str, list] = {}
    for m in read_ledger_moments(tmp_path):
        by_kind.setdefault(m.kind, []).append(m)
    perception = by_kind["perception"][0]
    assert "reply" not in by_kind
    silence = by_kind["silence"][0]
    assert silence.causation_ids == (perception.moment_id,)
    assert silence.content["reason"] == "no_reply"
    assert silence.content["response_policy"] == "reply_allowed"


async def test_observe_only_perception_records_without_reasoning(tmp_path: Path) -> None:
    """observe_only 进入经历链路，但 Deliberate 不调用推理、不生成回复。"""
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
                return [make_item(source="perception",
                                  content={"text": "群里在聊晚饭。", "scene_id": "napcat:group:42",
                                           "conversation_id": "conversation:napcat:group:42",
                                           "continuity_id": "continuity:napcat:group:42",
                                           "thread_id": "main",
                                           "recall_scope": "space_local",
                                           "disclosure_scope": "space_local",
                                           "trace_id": "tr-observe", "address_mode": "ambient",
                                       "response_policy": "observe_only", "familiarity": 1},
                              salience=0.5)]

    reasoning = _FakeReasoning("不应该生成")
    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            reasoning=reasoning,
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    by_kind: dict[str, list] = {}
    for m in read_ledger_moments(tmp_path):
        by_kind.setdefault(m.kind, []).append(m)
    assert reasoning.call_count == 0
    assert "reply" not in by_kind
    perception = by_kind["perception"][0]
    assert perception.content["response_policy"] == "observe_only"
    silence = by_kind["silence"][0]
    assert silence.causation_ids == (perception.moment_id,)
    assert silence.content["reason"] == "observe_only"
    assert silence.content["response_policy"] == "observe_only"
    digest = RecentExperienceSource(recorder).digest(
        "QQ 那边发生了什么", scene_id="napcat:group:42",
        conversation_id="conversation:napcat:group:42", actor_id=None,
        allowed_scopes={"space_local", "global_safe", "public"},
    )
    assert "群里在聊晚饭" in digest
    assert "沉默" not in digest


# ── 多模态：specialist_then_core 描述进 prompt / core_direct vision 直发（7.5b-5）──

class _Route:
    def __init__(self, *, primary_text="", semantic_text="", vision_messages=None):
        self.primary_text = primary_text
        self.semantic_text = semantic_text
        self.vision_messages = vision_messages or []

class _VM:
    def __init__(self, prompt, uri, mime):
        self.prompt = prompt
        self.uri = uri
        self.mime_type = mime

class _FakeRouter:
    def __init__(self, route): self._route = route
    def route(self, model_input): return self._route


async def test_multimodal_specialist_description_in_prompt(tmp_path: Path) -> None:
    """specialist_then_core：图片描述（semantic_text）进 system prompt。"""
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(source="perception",
                              content={"text": "", "scene_id": "s", "trace_id": "t",
                                       "address_mode": "direct", "familiarity": 8,
                                       "model_input": {"text": "", "items": []}},
                              salience=0.95)]

    router = _FakeRouter(_Route(primary_text="", semantic_text="一张开心的表情包"))
    cap = _CapturingReasoning("哈哈")
    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            reasoning=cap, multimodal_router=router,
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    assert cap.last_system is not None
    assert "一张开心的表情包" in cap.last_system   # 图片描述进 prompt
    assert cap.last_user == "[多模态输入]"          # 无文本 → 占位
    assert cap.last_vision == ()                    # specialist 策略无 vision 直发


async def test_multimodal_core_direct_vision_passed_to_request(tmp_path: Path) -> None:
    """core_direct：vision 消息随 ReasoningRequest 直发主模型 + 带 provider_key。"""
    from glimmer_cradle.cognition.cycle.providers import Provider
    from glimmer_cradle.cognition.cycle.volition import WillingnessConfig

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(source="perception",
                              content={"text": "看这个", "scene_id": "s", "trace_id": "t",
                                       "address_mode": "direct", "familiarity": 8,
                                       "model_input": {"text": "看这个", "items": []}},
                              salience=0.95)]

    class _MMCfg:
        core_model = "vision-pro"
    class _InfCfg:
        memory = type("M", (), {"max_recall_count": 5, "context_limit": 10})()
        multimodal = _MMCfg()
    class _Entity:
        inference_config = _InfCfg()

    route = _Route(primary_text="看这个",
                   vision_messages=[_VM("描述这张图", "http://img/1.png", "image/png")])
    router = _FakeRouter(route)
    cap = _CapturingReasoning("好看")
    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(
            workspace=ws, providers=[_Fixed()], experience_recorder=recorder,
            willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
            reasoning=cap, multimodal_router=router, self_entity=_Entity(),
        )
        await loop.tick_once()
    finally:
        await recorder.stop()

    assert cap.last_vision == (("描述这张图", "http://img/1.png", "image/png"),)
    assert cap.last_provider_key == "vision-pro"   # core_direct → 多模态主模型
    assert cap.last_user == "看这个"
