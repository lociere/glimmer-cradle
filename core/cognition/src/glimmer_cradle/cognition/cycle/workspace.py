"""
文件名称：workspace.py
所属层级：认知循环 —— 全局工作区（脊柱③）

核心作用：容量有限的"当前意识焦点"。专家模块投放候选 → 按 salience 竞争 →
最高显著度被广播给 Deliberation 阶段。

设计原则：
- 容量 = 7±2（对齐心理学 working memory 上限；默认 7）
- 新项超容量 → 按注意力排序淘汰最低项；排序先看 salience，再看来源优先级，
  最后看新鲜度
- 异步安全：所有读写经 ``asyncio.Lock`` —— providers 并发 propose 不冲突
- 衰减：每次写/读前先剪掉过期项（按 ``decay_at``）
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

# 复用 protocol 跨语言契约（铁律 1）—— TS 渲染层将来可读同一形状的工作区快照
from glimmer_cradle.cognition.protocol.generated.models.workspace_item import WorkspaceItem


__all__ = ["GlobalWorkspace", "WorkspaceItem", "make_item", "now_iso_ms"]


# ── 工具 ──────────────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso_ms() -> str:
    """返回 UTC 毫秒 ISO8601 时间戳（与经历之流 occurred_at 同格式）。"""
    return _now_utc().isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _parse_iso(s: str) -> datetime:
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def _is_expired(item: WorkspaceItem, now: datetime) -> bool:
    if not item.decay_at:
        return False
    try:
        return _parse_iso(item.decay_at) <= now
    except (ValueError, TypeError):
        return False


def _source_priority(item: WorkspaceItem) -> int:
    """同等 salience 下的注意力优先级。

    salience 仍是第一排序键；这里处理的是"同样显著"时谁更像当前角色此刻的现在。
    直接寻址的 perception 是外部互动义务，必须压过长驻的 drive；否则内在动机会
    在 1.0 封顶后把用户对话挡在工作区外。
    """
    if item.source == "perception":
        content = item.content if isinstance(item.content, dict) else {}
        return 100 if content.get("address_mode") == "direct" else 80
    priorities = {
        "affect": 70,
        "memory": 60,
        "social": 60,
        "drive": 40,
    }
    return priorities.get(item.source, 0)


def _freshness_ms(item: WorkspaceItem) -> float:
    try:
        return _parse_iso(item.created_at).timestamp() * 1000.0
    except (ValueError, TypeError, AttributeError):
        return 0.0


def _attention_rank(item: WorkspaceItem) -> tuple[float, int, float]:
    return (float(item.salience), _source_priority(item), _freshness_ms(item))


def make_item(
    *,
    source: str,
    content: dict,
    salience: float,
    decay_at: str | None = None,
) -> WorkspaceItem:
    """便利构造：自动填 item_id 与 created_at。

    Provider 用这个工厂投放，不必关心 ID/时间字段。
    """
    return WorkspaceItem(
        item_id=uuid.uuid4().hex,
        source=source,
        content=content,
        salience=salience,
        created_at=now_iso_ms(),
        decay_at=decay_at,
    )


# ── 全局工作区 ────────────────────────────────────────────────────────────

class GlobalWorkspace:
    """LIDA 风格的全局工作区。"""

    def __init__(self, *, capacity: int = 7) -> None:
        if capacity < 1:
            raise ValueError("capacity 必须 >= 1")
        self._capacity: int = capacity
        self._items: list[WorkspaceItem] = []
        self._lock: asyncio.Lock = asyncio.Lock()

    @property
    def capacity(self) -> int:
        return self._capacity

    async def propose(self, item: WorkspaceItem) -> bool:
        """投入新候选。返回是否被接纳。

        - 容量未满：直接接纳
        - 容量已满：若新项注意力排序高于现存最低，则淘汰最低、接纳新项
        - 否则拒收
        """
        async with self._lock:
            self._prune_expired_locked(_now_utc())
            if len(self._items) < self._capacity:
                self._items.append(item)
                return True
            # 找最低
            min_idx = min(range(len(self._items)), key=lambda i: _attention_rank(self._items[i]))
            if _attention_rank(item) > _attention_rank(self._items[min_idx]):
                self._items.pop(min_idx)
                self._items.append(item)
                return True
            return False

    async def broadcast(self) -> WorkspaceItem | None:
        """取本拍的"意识内容" —— 当前 salience 最高的项。空时返回 None。"""
        async with self._lock:
            self._prune_expired_locked(_now_utc())
            if not self._items:
                return None
            return max(self._items, key=_attention_rank)

    async def snapshot(self) -> list[WorkspaceItem]:
        """返回当前所有项的副本（监控用，state_sync 等）。"""
        async with self._lock:
            self._prune_expired_locked(_now_utc())
            return list(self._items)

    async def remove(self, item_id: str) -> bool:
        """按 item_id 移除一项，返回是否真的移除。"""
        async with self._lock:
            before = len(self._items)
            self._items = [it for it in self._items if it.item_id != item_id]
            return len(self._items) != before

    async def prune_expired(self) -> int:
        """主动剪掉过期项，返回剪掉的数量。"""
        async with self._lock:
            return self._prune_expired_locked(_now_utc())

    async def clear(self) -> None:
        """清空（测试 / 复位用）。"""
        async with self._lock:
            self._items.clear()

    async def size(self) -> int:
        async with self._lock:
            self._prune_expired_locked(_now_utc())
            return len(self._items)

    # ── 内部：调用方必须持锁 ─────────────────────────────────────────────
    def _prune_expired_locked(self, now: datetime) -> int:
        before = len(self._items)
        self._items = [it for it in self._items if not _is_expired(it, now)]
        return before - len(self._items)
