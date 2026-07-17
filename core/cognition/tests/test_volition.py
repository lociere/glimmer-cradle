"""Volition：willingness 公式 + arbiter 仲裁 测试（阶段 5.7）。"""
import pytest
from glimmer_cradle.cognition.experience.recorder import ExperienceRecorder

from glimmer_cradle.cognition.cycle.volition import (
    Intent,
    WillingnessConfig,
    WillingnessInputs,
    arbitrate,
    compute_willingness,
    make_intent,
    threshold_for,
)


# ═════════════════════════════ Willingness ═══════════════════════════════

def test_willingness_zero_inputs_returns_default_persona_only() -> None:
    # 全零 + default extraversion 0.5；只有 persona 项贡献 0.5*0.1 = 0.05
    w = compute_willingness(WillingnessInputs())
    assert w == pytest.approx(0.05)


def test_willingness_direct_address_dominates_over_ambient() -> None:
    direct = compute_willingness(WillingnessInputs(address_mode="direct"))
    ambient = compute_willingness(WillingnessInputs(address_mode="ambient"))
    assert direct > ambient


def test_willingness_strong_emotion_increases() -> None:
    base = compute_willingness(WillingnessInputs())
    strong = compute_willingness(WillingnessInputs(emotion_intensity=0.9))
    assert strong > base


def test_willingness_high_intimacy_increases() -> None:
    base = compute_willingness(WillingnessInputs())
    high = compute_willingness(WillingnessInputs(relationship_intimacy=1.0))
    assert high > base


def test_willingness_silence_normalized() -> None:
    # silence_seconds 等于 normalize_s → silence_score = 1.0
    cfg = WillingnessConfig(silence_normalize_s=300.0)
    w_short = compute_willingness(WillingnessInputs(silence_seconds=10.0), cfg)
    w_long = compute_willingness(WillingnessInputs(silence_seconds=300.0), cfg)
    w_very_long = compute_willingness(WillingnessInputs(silence_seconds=10000.0), cfg)
    assert w_short < w_long
    assert w_very_long == w_long  # 已 clip 到 1.0


def test_willingness_extraversion_override() -> None:
    # 显式 extraversion=1.0 > default 0.5
    w_default = compute_willingness(WillingnessInputs())
    w_extra = compute_willingness(WillingnessInputs(persona_extraversion=1.0))
    assert w_extra > w_default


def test_willingness_capped_at_one() -> None:
    # 全部最大
    w = compute_willingness(WillingnessInputs(
        address_mode="direct",
        emotion_intensity=1.0,
        relationship_intimacy=1.0,
        drive_companionship=1.0,
        silence_seconds=10000.0,
        persona_extraversion=1.0,
    ))
    assert w == 1.0  # 默认权重 sum = 1.0


def test_willingness_unknown_address_mode_zero_address_score() -> None:
    # address_mode 是空串 → address_score = 0
    w1 = compute_willingness(WillingnessInputs(address_mode=""))
    w2 = compute_willingness(WillingnessInputs(address_mode="weird"))
    assert w1 == w2


# ── threshold ────────────────────────────────────────────────────────────

def test_threshold_by_activity_state() -> None:
    cfg = WillingnessConfig()
    assert threshold_for("engaged", cfg) < threshold_for("ambient", cfg)
    assert threshold_for("ambient", cfg) < threshold_for("quiescent", cfg)
    assert threshold_for("quiescent", cfg) > 1.0  # 永远不达


def test_threshold_unknown_state_default() -> None:
    assert threshold_for("alien", WillingnessConfig()) == 0.5


# ═════════════════════════════ make_intent ═══════════════════════════════

def test_make_intent_fills_id_and_timestamp() -> None:
    intent = make_intent(type="reply", initiative="reactive", willingness=0.7, payload={"text": "嗯"})
    assert intent.intent_id and len(intent.intent_id) == 32
    assert intent.created_at.endswith("Z")
    assert intent.willingness == 0.7
    assert intent.type.value == "reply"
    assert intent.initiative.value == "reactive"


def test_make_intent_willingness_clipped() -> None:
    intent = make_intent(type="thought", initiative="proactive", willingness=2.5)
    assert intent.willingness == 1.0
    intent2 = make_intent(type="thought", initiative="proactive", willingness=-0.5)
    assert intent2.willingness == 0.0


def test_make_intent_default_payload_empty_dict() -> None:
    intent = make_intent(type="silence", initiative="reactive", willingness=0.3)
    assert intent.payload == {}


# ═════════════════════════════ Arbiter ════════════════════════════════════

def _intent(type: str, willingness: float, initiative: str = "proactive") -> Intent:
    return make_intent(type=type, initiative=initiative, willingness=willingness)


def test_arbitrate_below_threshold_suppressed() -> None:
    intents = [_intent("reply", 0.3)]
    result = arbitrate(intents, threshold=0.5, allows_proactive=True)
    assert result.accepted == []
    assert len(result.suppressed) == 1
    assert result.suppressed[0][1] == "below_threshold"


def test_arbitrate_proactive_blocked_when_disallowed() -> None:
    intents = [
        _intent("reply", 0.9),
        _intent("thought", 0.8),
        _intent("emotion", 0.7, initiative="reactive"),  # 响应性情绪外显，放过
    ]
    result = arbitrate(intents, threshold=0.5, allows_proactive=False)
    accepted_types = {it.type.value for it in result.accepted}
    assert accepted_types == {"emotion"}
    blocked_reasons = [r for _, r in result.suppressed]
    assert blocked_reasons.count("proactive_blocked") == 2


def test_arbitrate_reactive_action_bypasses_proactive_willingness_gate() -> None:
    intent = _intent("action", 0.1, initiative="reactive")
    result = arbitrate([intent], threshold=1.1, allows_proactive=False)
    assert result.accepted == [intent]
    assert result.suppressed == []


def test_arbitrate_reply_uniqueness_highest_wins() -> None:
    intents = [
        _intent("reply", 0.6),
        _intent("reply", 0.9),  # 应胜出
        _intent("reply", 0.7),
        _intent("thought", 0.8),
    ]
    result = arbitrate(intents, threshold=0.5, allows_proactive=True)
    # 1 个 reply（最高）+ 1 个 thought
    assert len(result.accepted) == 2
    reply_in_accepted = [it for it in result.accepted if it.type.value == "reply"]
    assert len(reply_in_accepted) == 1
    assert reply_in_accepted[0].willingness == 0.9
    # 2 个 reply 被压
    duplicate_count = sum(1 for _, r in result.suppressed if r == "reply_duplicate")
    assert duplicate_count == 2


def test_arbitrate_accepted_sorted_by_willingness_desc() -> None:
    intents = [
        _intent("thought", 0.6),
        _intent("emotion", 0.9),
        _intent("action", 0.7),
    ]
    result = arbitrate(intents, threshold=0.5, allows_proactive=True)
    willingness = [it.willingness for it in result.accepted]
    assert willingness == sorted(willingness, reverse=True)


def test_arbitrate_empty_input() -> None:
    result = arbitrate([], threshold=0.5, allows_proactive=True)
    assert result.accepted == []
    assert result.suppressed == []


def test_arbitrate_threshold_exact_match_accepted() -> None:
    """willingness == threshold 按"达阈"算（不严格大于）。"""
    intent = _intent("reply", 0.5)
    result = arbitrate([intent], threshold=0.5, allows_proactive=True)
    assert len(result.accepted) == 1


def test_arbitrate_proactive_blocked_dormant_scenario() -> None:
    """Quiescent 状态：阈值 1.1 + allows_proactive=False。"""
    intents = [_intent("reply", 0.99)]
    threshold = threshold_for("quiescent", WillingnessConfig())
    result = arbitrate(intents, threshold=threshold, allows_proactive=False)
    assert result.accepted == []
    # 被先 below_threshold 压住，根本到不了 proactive 检查
    assert any(r == "below_threshold" for _, r in result.suppressed)


# ═════════════════════════════ CycleController 集成 ═════════════════════════

async def test_cycle_intend_with_perception_creates_reply_intent(tmp_path) -> None:
    """CycleController 接 Volition 后：perception 广播 → reply intent。"""
    from glimmer_cradle.cognition.cycle import CycleController, GlobalWorkspace
    from glimmer_cradle.cognition.cycle.workspace import make_item
    from glimmer_cradle.cognition.cycle.providers import Provider

    from glimmer_cradle.cognition.inference.service import ReasoningResponse

    class _Fixed(Provider):
        name = "perception"
        async def propose(self, snap):
            return [make_item(
                source="perception",
                content={"text": "你好", "address_mode": "direct",
                         "familiarity": 8, "scene_id": "s"},
                salience=0.9,
            )]

    class _FakeReasoning:
        async def request(self, req, *, tier):
            return ReasoningResponse(text="你好呀", tier_used=tier)

    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        # 默认 awake 阈值 0.4；纯 direct address（0.3）+ 默认外向（0.05）= 0.35
        # 不达阈。用低阈值 config 测试链路：确认 perception → reply intent 这条
        # wiring 在阈值过得去时正确工作（默认参数下"光被叫不够回应"是合理策略）。
        cfg = WillingnessConfig(threshold_by_activity={"engaged": 0.2})
        loop = CycleController(workspace=ws, providers=[_Fixed()],
                             experience_recorder=recorder,
                             willingness_config=cfg,
                             reasoning=_FakeReasoning())  # 阶段 7.2 生成回复
        await loop.tick_once()
        result = loop.last_arbitration
        assert result is not None
        assert len(result.accepted) == 1
        intent = result.accepted[0]
        assert intent.type.value == "reply"
        # 阶段 7.2：回复文本来自 Deliberate 生成（非回显用户的"你好"）
        assert intent.payload["text"] == "你好呀"
        assert intent.willingness > 0  # direct + ... 应过阈
    finally:
        await recorder.stop()


async def test_loop_intend_no_broadcast_no_intent(tmp_path) -> None:
    """无广播（providers 全空）→ 无意图。"""
    from glimmer_cradle.cognition.cycle import CycleController, GlobalWorkspace

    ws = GlobalWorkspace()
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(workspace=ws, providers=[],
                             experience_recorder=recorder)
        await loop.tick_once()
        result = loop.last_arbitration
        assert result is not None
        assert result.accepted == []
        assert result.suppressed == []
    finally:
        await recorder.stop()


async def test_loop_intend_drive_source_creates_thought(tmp_path) -> None:
    """drive(curiosity) 广播 → thought intent；不是 reply。"""
    from glimmer_cradle.cognition.cycle import CycleController, GlobalWorkspace
    from glimmer_cradle.cognition.cycle.workspace import make_item
    from glimmer_cradle.cognition.cycle.providers import Provider

    class _Fixed(Provider):
        name = "drive"
        async def propose(self, snap):
            return [make_item(
                source="drive",
                content={"drive": "curiosity", "level": 0.8,
                         "all_levels": {"curiosity": 0.8, "companionship": 0.2, "rest": 0.1}},
                salience=0.8,
            )]

    ws = GlobalWorkspace(capacity=3)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    try:
        loop = CycleController(workspace=ws, providers=[_Fixed()],
                             experience_recorder=recorder,
                             willingness_config=WillingnessConfig(
                                 threshold_by_activity={"engaged": 0.0},  # 直放
                             ))
        await loop.tick_once()
        result = loop.last_arbitration
        assert result is not None
        # 默认无 activity → state="engaged"；threshold 0.0 直放
        assert len(result.accepted) == 1
        assert result.accepted[0].type.value == "thought"
    finally:
        await recorder.stop()
