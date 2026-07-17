"""PerceptionProvider + PerceptionEventQueue 测试（阶段 5.6c）。"""
import pytest

from glimmer_cradle.cognition.cycle.perception_queue import PerceptionEntry, PerceptionEventQueue
from glimmer_cradle.cognition.cycle.providers import PerceptionProvider
from glimmer_cradle.cognition.cycle.providers.perception import salience_for_perception


def _entry(*, address_mode="direct", familiarity=5, text="hi",
           scene_id="napcat:group:1", trace_id="t1", actor_id=None,
           actor_name=None, response_policy="reply_allowed") -> PerceptionEntry:
    return PerceptionEntry(
        scene_id=scene_id,
        conversation_id=f"conversation:{scene_id}",
        continuity_id="continuity:test-user",
        thread_id="main",
        recall_scope="conversation_private",
        disclosure_scope="conversation_private",
        address_mode=address_mode,
        familiarity=familiarity,
        response_policy=response_policy,
        text=text,
        trace_id=trace_id,
        actor_id=actor_id,
        actor_name=actor_name,
    )


# ═══════════════════════════ Queue 行为 ═══════════════════════════════════

def test_queue_put_and_drain_fifo() -> None:
    q = PerceptionEventQueue(max_size=10)
    q.put(_entry(text="A"))
    q.put(_entry(text="B"))
    q.put(_entry(text="C"))
    drained = q.drain(max_items=10)
    assert [e.text for e in drained] == ["A", "B", "C"]
    assert q.size() == 0


def test_queue_drain_partial() -> None:
    q = PerceptionEventQueue(max_size=10)
    for i in range(5):
        q.put(_entry(text=f"e{i}"))
    drained = q.drain(max_items=2)
    assert len(drained) == 2
    assert q.size() == 3
    # 剩下的还能再 drain
    remaining = q.drain(max_items=10)
    assert len(remaining) == 3


def test_queue_max_size_drops_oldest() -> None:
    q = PerceptionEventQueue(max_size=3)
    for i in range(5):
        q.put(_entry(text=f"e{i}"))
    assert q.size() == 3
    drained = q.drain(max_items=10)
    # 最旧的 e0, e1 被挤掉；留 e2, e3, e4
    assert [e.text for e in drained] == ["e2", "e3", "e4"]


def test_queue_drain_empty_returns_empty() -> None:
    q = PerceptionEventQueue()
    assert q.drain() == []


def test_queue_invalid_max_size() -> None:
    with pytest.raises(ValueError):
        PerceptionEventQueue(max_size=0)


def test_queue_clear() -> None:
    q = PerceptionEventQueue()
    q.put(_entry())
    q.put(_entry())
    q.clear()
    assert q.size() == 0


# ═══════════════════════════ salience 公式 ═══════════════════════════════

def test_salience_direct_with_high_familiarity() -> None:
    assert salience_for_perception(address_mode="direct", familiarity=10) == 1.0


def test_salience_direct_always_caps_attention() -> None:
    assert salience_for_perception(address_mode="direct", familiarity=-5) == 1.0
    assert salience_for_perception(address_mode="direct", familiarity=5) == 1.0


def test_salience_ambient_with_zero_familiarity() -> None:
    # 0.4 + 0 = 0.4
    assert salience_for_perception(address_mode="ambient", familiarity=0) == pytest.approx(0.4)


def test_salience_direct_dominates_ambient() -> None:
    direct = salience_for_perception(address_mode="direct", familiarity=5)
    ambient = salience_for_perception(address_mode="ambient", familiarity=5)
    assert direct > ambient


def test_salience_familiarity_clipped() -> None:
    # ambient familiarity 越界（>10）也按 10 算
    assert salience_for_perception(address_mode="ambient", familiarity=99) == pytest.approx(0.7)
    assert salience_for_perception(address_mode="ambient", familiarity=-5) == pytest.approx(0.4)


def test_salience_floor_at_point_one() -> None:
    # 即使 base 极小（未来若改公式），下限 0.1
    assert salience_for_perception(address_mode="weird", familiarity=0) >= 0.1


# ═══════════════════════════ Provider 行为 ═══════════════════════════════

async def test_provider_empty_queue_returns_empty() -> None:
    q = PerceptionEventQueue()
    p = PerceptionProvider(q)
    assert await p.propose([]) == []


async def test_provider_drains_and_proposes() -> None:
    q = PerceptionEventQueue()
    q.put(_entry(text="你好", address_mode="direct", familiarity=8))
    q.put(_entry(text="哈喽", address_mode="ambient", familiarity=2))
    p = PerceptionProvider(q)
    items = await p.propose([])
    assert len(items) == 2
    assert all(it.source == "perception" for it in items)
    assert items[0].content["text"] == "你好"
    assert items[0].content["address_mode"] == "direct"
    assert items[0].content["response_policy"] == "reply_allowed"
    assert items[0].salience == 1.0
    # ambient + familiarity=2 → 0.4 + 0.06 = 0.46
    assert items[1].salience == pytest.approx(0.46)
    assert q.size() == 0  # 已 drain


async def test_provider_carries_response_policy() -> None:
    q = PerceptionEventQueue()
    q.put(_entry(address_mode="ambient", response_policy="observe_only"))
    p = PerceptionProvider(q)
    items = await p.propose([])
    assert items[0].content["response_policy"] == "observe_only"


async def test_provider_max_items_per_tick_caps_drain() -> None:
    q = PerceptionEventQueue()
    for i in range(10):
        q.put(_entry(text=f"e{i}"))
    p = PerceptionProvider(q, max_items_per_tick=3)
    items = await p.propose([])
    assert len(items) == 3
    assert q.size() == 7  # 留 7 个等下一拍


async def test_provider_carries_actor_info_when_present() -> None:
    q = PerceptionEventQueue()
    q.put(_entry(actor_id="napcat:user:U_1", actor_name="Alice"))
    p = PerceptionProvider(q)
    items = await p.propose([])
    assert items[0].content["actor_id"] == "napcat:user:U_1"
    assert items[0].content["actor_name"] == "Alice"


async def test_provider_omits_actor_fields_when_absent() -> None:
    q = PerceptionEventQueue()
    q.put(_entry(actor_id=None, actor_name=None))
    p = PerceptionProvider(q)
    items = await p.propose([])
    assert "actor_id" not in items[0].content
    assert "actor_name" not in items[0].content
