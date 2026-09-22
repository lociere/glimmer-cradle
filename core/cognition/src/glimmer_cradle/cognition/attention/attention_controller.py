"""有界注意候选、竞争与 focus lease 的唯一 owner。"""

from __future__ import annotations

import asyncio
from datetime import datetime

from glimmer_cradle.cognition.attention.attention import (
    Attention,
    AttentionSource,
    attention_rank,
    is_expired,
)
from glimmer_cradle.cognition.attention.attention_lease import CognitiveAttentionLease
from glimmer_cradle.cognition.ports.clock import ClockPort


class AttentionController:
    def __init__(
        self,
        *,
        capacity: int = 7,
        lease_seconds: float = 30.0,
        clock: ClockPort,
    ) -> None:
        if capacity < 1:
            raise ValueError("capacity 必须 >= 1")
        if lease_seconds <= 0:
            raise ValueError("lease_seconds 必须 > 0")
        self._capacity = capacity
        self._lease_seconds = lease_seconds
        self._clock = clock
        self._items: list[Attention] = []
        self._lease: CognitiveAttentionLease | None = None
        self._lock = asyncio.Lock()

    @property
    def capacity(self) -> int:
        return self._capacity

    @property
    def lease(self) -> CognitiveAttentionLease | None:
        return self._lease

    async def propose(self, attention: Attention) -> bool:
        accepted, _ = await self.propose_with_eviction(attention)
        return accepted

    async def propose_with_eviction(
        self,
        attention: Attention,
    ) -> tuple[bool, Attention | None]:
        async with self._lock:
            self._prune_expired_locked(self._clock.now())
            if len(self._items) < self._capacity:
                self._items.append(attention)
                return True, None
            index = min(range(len(self._items)), key=lambda i: attention_rank(self._items[i]))
            if attention_rank(attention) <= attention_rank(self._items[index]):
                return False, None
            evicted = self._items.pop(index)
            self._items.append(attention)
            if self._lease is not None and self._lease.attention_id == evicted.attention_id:
                self._lease = None
            return True, evicted

    async def focus(self) -> Attention | None:
        async with self._lock:
            now = self._clock.now()
            self._prune_expired_locked(now)
            if not self._items:
                self._lease = None
                return None
            if self._lease is not None and self._lease.is_valid(now):
                leased = next(
                    (item for item in self._items if item.attention_id == self._lease.attention_id),
                    None,
                )
                if leased is not None:
                    return leased
            focused = max(self._items, key=attention_rank)
            self._lease = CognitiveAttentionLease.acquire(
                focused.attention_id,
                now=now,
                duration_seconds=self._lease_seconds,
            )
            return focused

    async def snapshot(self) -> list[Attention]:
        async with self._lock:
            self._prune_expired_locked(self._clock.now())
            return list(self._items)

    async def remove(self, attention_id: str) -> bool:
        async with self._lock:
            before = len(self._items)
            self._items = [item for item in self._items if item.attention_id != attention_id]
            removed = len(self._items) != before
            if removed and self._lease is not None and self._lease.attention_id == attention_id:
                self._lease = None
            return removed

    async def remove_perception(self, trace_id: str) -> bool:
        async with self._lock:
            removed_ids = {
                item.attention_id
                for item in self._items
                if item.source == AttentionSource.PERCEPTION
                and item.content.get("trace_id") == trace_id
            }
            self._items = [item for item in self._items if item.attention_id not in removed_ids]
            if self._lease is not None and self._lease.attention_id in removed_ids:
                self._lease = None
            return bool(removed_ids)

    async def prune_expired(self) -> int:
        async with self._lock:
            return self._prune_expired_locked(self._clock.now())

    async def clear(self) -> None:
        async with self._lock:
            self._items.clear()
            self._lease = None

    async def size(self) -> int:
        async with self._lock:
            self._prune_expired_locked(self._clock.now())
            return len(self._items)

    def _prune_expired_locked(self, now: datetime) -> int:
        expired_ids = {
            item.attention_id for item in self._items if is_expired(item, now)
        }
        if not expired_ids:
            return 0
        self._items = [item for item in self._items if item.attention_id not in expired_ids]
        if self._lease is not None and self._lease.attention_id in expired_ids:
            self._lease = None
        return len(expired_ids)
