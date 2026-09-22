"""Cognition ingress 与 Attention Provider 之间的有界 Observation 队列。"""

from __future__ import annotations

import collections

from glimmer_cradle.cognition.perception.observation import Observation


class ObservationQueue:
    def __init__(self, *, max_size: int = 100) -> None:
        if max_size < 1:
            raise ValueError("max_size 必须 >= 1")
        self._max_size = max_size
        self._queue: collections.deque[Observation] = collections.deque(maxlen=max_size)

    def put(self, observation: Observation) -> Observation | None:
        dropped = self._queue[0] if len(self._queue) == self._max_size else None
        self._queue.append(observation)
        return dropped

    def drain(self, *, max_items: int = 10) -> list[Observation]:
        if max_items < 1:
            return []
        results: list[Observation] = []
        while self._queue and len(results) < max_items:
            results.append(self._queue.popleft())
        return results

    def size(self) -> int:
        return len(self._queue)

    def remove(self, trace_id: str) -> bool:
        before = len(self._queue)
        self._queue = collections.deque(
            (item for item in self._queue if item.trace_id != trace_id),
            maxlen=self._max_size,
        )
        return len(self._queue) != before

    @property
    def max_size(self) -> int:
        return self._max_size

    def clear(self) -> None:
        self._queue.clear()
