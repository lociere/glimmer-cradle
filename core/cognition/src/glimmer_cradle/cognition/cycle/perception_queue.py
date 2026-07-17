"""Kernel Inbound Port 与 CycleController 之间的感知事件缓冲。

设计要点：
- **有界 + drop-oldest**：``deque(maxlen=N)`` 满则挤掉最旧。感知事件越老越无价值。
- **简单同步**：`put` / `drain` 同步方法即可 —— Python asyncio 单线程，没有
  并发争用；用 deque 自带的 thread-safe append/popleft 已足够。

入站路径：Composition 注册的感知 handler 解析后 `put` → PerceptionProvider 每拍
``drain()`` 取出投放 WorkspaceItem → CycleController 编排。
"""
from __future__ import annotations

import collections
from dataclasses import dataclass


@dataclass(frozen=True)
class PerceptionEntry:
    """进入全局工作区前的最小规范化感知。"""

    scene_id: str
    conversation_id: str
    continuity_id: str
    thread_id: str
    recall_scope: str
    disclosure_scope: str
    address_mode: str  # 'direct' / 'ambient'
    familiarity: int   # 0..10
    text: str          # 主文本（纯文本消息即正文；多模态消息可能为空）
    response_policy: str = "reply_allowed"  # 'reply_allowed' / 'observe_only'
    trace_id: str = ""
    actor_id: str | None = None
    actor_name: str | None = None
    # 保留规范化多模态内容，由 PerceptionAppraiser 单次路由后复用。
    model_input: dict | None = None
    origin: dict | None = None
    retention_ceiling: str = "experience"
    interaction_id: str = ""


class PerceptionEventQueue:
    """有界 FIFO 队列。"""

    def __init__(self, *, max_size: int = 100) -> None:
        if max_size < 1:
            raise ValueError("max_size 必须 >= 1")
        self._max_size = max_size
        self._queue: collections.deque[PerceptionEntry] = collections.deque(maxlen=max_size)

    def put(self, entry: PerceptionEntry) -> None:
        """投放一条事件；队满时自动挤掉最旧（deque maxlen 语义）。"""
        self._queue.append(entry)

    def drain(self, *, max_items: int = 10) -> list[PerceptionEntry]:
        """取出至多 ``max_items`` 条；FIFO 顺序。"""
        if max_items < 1:
            return []
        results: list[PerceptionEntry] = []
        while self._queue and len(results) < max_items:
            results.append(self._queue.popleft())
        return results

    def size(self) -> int:
        return len(self._queue)

    @property
    def max_size(self) -> int:
        return self._max_size

    def clear(self) -> None:
        self._queue.clear()
