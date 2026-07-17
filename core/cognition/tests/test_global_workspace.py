"""GlobalWorkspace 单测（阶段 5.1）。"""
from datetime import datetime, timedelta, timezone

import pytest

from glimmer_cradle.cognition.cycle.workspace import GlobalWorkspace, make_item, now_iso_ms


def _item(source: str, salience: float, *, decay_in_seconds: float | None = None,
          content: dict | None = None):
    decay_at = None
    if decay_in_seconds is not None:
        decay_at = (datetime.now(timezone.utc) + timedelta(seconds=decay_in_seconds)) \
            .isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return make_item(
        source=source,
        content=content or {"v": source},
        salience=salience,
        decay_at=decay_at,
    )


# ── 容量未满：接纳 ───────────────────────────────────────────────────────

async def test_propose_under_capacity_accepts() -> None:
    ws = GlobalWorkspace(capacity=3)
    assert await ws.propose(_item("perception", 0.5)) is True
    assert await ws.size() == 1


async def test_multiple_propose_fills_to_capacity() -> None:
    ws = GlobalWorkspace(capacity=3)
    for s in [0.1, 0.5, 0.9]:
        assert await ws.propose(_item("memory", s)) is True
    assert await ws.size() == 3


# ── 容量已满：按 salience 淘汰最低 ───────────────────────────────────────

async def test_propose_at_capacity_evicts_lowest() -> None:
    ws = GlobalWorkspace(capacity=3)
    await ws.propose(_item("memory", 0.1))
    await ws.propose(_item("memory", 0.5))
    await ws.propose(_item("memory", 0.9))
    # 新项 0.6 > 现存最低 0.1 → 接纳
    assert await ws.propose(_item("drive", 0.6)) is True
    snap = await ws.snapshot()
    saliences = sorted(it.salience for it in snap)
    assert saliences == [0.5, 0.6, 0.9]  # 0.1 被淘汰


async def test_propose_rejected_when_weaker_than_lowest() -> None:
    ws = GlobalWorkspace(capacity=2)
    await ws.propose(_item("memory", 0.7))
    await ws.propose(_item("memory", 0.8))
    # 新项 0.3 < 现存最低 0.7 → 拒收
    assert await ws.propose(_item("drive", 0.3)) is False
    snap = await ws.snapshot()
    assert sorted(it.salience for it in snap) == [0.7, 0.8]


async def test_direct_perception_replaces_equal_drive_at_capacity() -> None:
    """直接对话是互动义务：同等 salience 下应压过长驻 drive。"""
    ws = GlobalWorkspace(capacity=2)
    await ws.propose(_item("drive", 1.0, content={"drive": "curiosity"}))
    await ws.propose(_item("drive", 1.0, content={"drive": "companionship"}))

    accepted = await ws.propose(_item(
        "perception",
        1.0,
        content={"text": "你好", "address_mode": "direct", "scene_id": "desktop-ui:user"},
    ))

    assert accepted is True
    snap = await ws.snapshot()
    assert any(it.source == "perception" for it in snap)
    assert len(snap) == 2


# ── 广播 ─────────────────────────────────────────────────────────────────

async def test_broadcast_empty_returns_none() -> None:
    ws = GlobalWorkspace()
    assert await ws.broadcast() is None


async def test_broadcast_returns_highest_salience() -> None:
    ws = GlobalWorkspace(capacity=5)
    await ws.propose(_item("memory", 0.3, content={"v": "memo"}))
    await ws.propose(_item("affect", 0.7, content={"v": "feel"}))
    await ws.propose(_item("drive", 0.5, content={"v": "drive"}))
    top = await ws.broadcast()
    assert top is not None
    assert top.salience == 0.7
    assert top.source == "affect"


async def test_broadcast_tie_prefers_direct_perception_over_drive() -> None:
    ws = GlobalWorkspace(capacity=5)
    await ws.propose(_item("drive", 1.0, content={"drive": "companionship"}))
    await ws.propose(_item(
        "perception",
        1.0,
        content={"text": "在吗", "address_mode": "direct", "scene_id": "desktop-ui:user"},
    ))

    top = await ws.broadcast()

    assert top is not None
    assert top.source == "perception"
    assert top.content["text"] == "在吗"


# ── 衰减 ─────────────────────────────────────────────────────────────────

async def test_expired_items_pruned_on_access() -> None:
    ws = GlobalWorkspace(capacity=5)
    await ws.propose(_item("memory", 0.9, decay_in_seconds=-1))  # 已过期
    await ws.propose(_item("memory", 0.4))  # 未过期
    # broadcast 会先 prune
    top = await ws.broadcast()
    assert top is not None
    assert top.salience == 0.4  # 0.9 已过期


async def test_prune_expired_returns_count() -> None:
    import asyncio
    ws = GlobalWorkspace(capacity=5)
    # 投放时尚未过期，propose 不会剪掉；之后小睡使其过期，再显式 prune
    await ws.propose(_item("memory", 0.1, decay_in_seconds=0.05))
    await ws.propose(_item("affect", 0.2, decay_in_seconds=0.05))
    await ws.propose(_item("drive", 0.3))  # 永久
    await asyncio.sleep(0.1)
    pruned = await ws.prune_expired()
    assert pruned == 2
    assert await ws.size() == 1


# ── snapshot 是副本 ──────────────────────────────────────────────────────

async def test_snapshot_returns_copy() -> None:
    ws = GlobalWorkspace(capacity=3)
    await ws.propose(_item("memory", 0.5))
    snap = await ws.snapshot()
    snap.clear()  # 修改 snapshot 不影响 workspace
    assert await ws.size() == 1


# ── 杂项 ─────────────────────────────────────────────────────────────────

async def test_clear_empties_workspace() -> None:
    ws = GlobalWorkspace(capacity=3)
    await ws.propose(_item("memory", 0.5))
    await ws.propose(_item("memory", 0.5))
    await ws.clear()
    assert await ws.size() == 0


def test_invalid_capacity_raises() -> None:
    with pytest.raises(ValueError):
        GlobalWorkspace(capacity=0)


def test_make_item_fills_id_and_created_at() -> None:
    it = make_item(source="perception", content={"text": "hi"}, salience=0.5)
    assert it.item_id and len(it.item_id) >= 32  # UUID hex
    assert it.created_at.endswith("Z")
    assert it.salience == 0.5
    assert it.source == "perception"


def test_now_iso_ms_format() -> None:
    s = now_iso_ms()
    assert s.endswith("Z") and "T" in s
