"""Cognition ingress 与 Attention Provider 之间的有界 Observation 队列。"""

from __future__ import annotations

import asyncio
import collections
from dataclasses import dataclass

from glimmer_cradle.cognition.perception.observation import Observation


TERMINAL_OPERATION_STATES = frozenset({"succeeded", "cancelled", "failed"})


class PerceptionOperationConflict(ValueError):
    """同一稳定 operation_id 或 trace 被绑定到不同调用。"""


@dataclass(slots=True)
class PerceptionOperation:
    operation_id: str
    trace_id: str
    state: str = "accepted"
    safe_message: str = ""
    task: asyncio.Task | None = None

    @property
    def terminal(self) -> bool:
        return self.state in TERMINAL_OPERATION_STATES


class PerceptionOperationRegistry:
    """把 transport ACK 绑定到实际 Loop task，并保留可查询终态。"""

    def __init__(self) -> None:
        self._by_operation: dict[str, PerceptionOperation] = {}
        self._operation_by_trace: dict[str, str] = {}

    def accept(self, operation_id: str, trace_id: str) -> tuple[PerceptionOperation, bool]:
        existing = self._by_operation.get(operation_id)
        if existing is not None:
            if existing.trace_id != trace_id:
                raise PerceptionOperationConflict("感知 operation_id 已绑定到不同 trace")
            return existing, True
        existing_id = self._operation_by_trace.get(trace_id)
        if existing_id is not None:
            raise PerceptionOperationConflict("感知 trace 已绑定到不同 operation_id")
        operation = PerceptionOperation(operation_id=operation_id, trace_id=trace_id)
        self._by_operation[operation_id] = operation
        self._operation_by_trace[trace_id] = operation_id
        self._trim()
        return operation, False

    def get(self, operation_id: str) -> PerceptionOperation | None:
        return self._by_operation.get(operation_id)

    def get_by_trace(self, trace_id: str) -> PerceptionOperation | None:
        operation_id = self._operation_by_trace.get(trace_id)
        return self._by_operation.get(operation_id) if operation_id else None

    def mark_running(self, trace_id: str, task: asyncio.Task) -> None:
        operation = self.get_by_trace(trace_id)
        if operation is not None and not operation.terminal:
            operation.state = "running"
            operation.task = task

    def finish(self, trace_id: str, state: str, safe_message: str = "") -> bool:
        operation = self.get_by_trace(trace_id)
        if operation is not None and not operation.terminal:
            operation.state = state
            operation.safe_message = safe_message
            operation.task = None
            return True
        return False

    async def cancel(self, trace_id: str) -> PerceptionOperation | None:
        operation = self.get_by_trace(trace_id)
        if operation is None or operation.terminal:
            return operation
        task = operation.task
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self.finish(trace_id, "cancelled", "感知操作已取消")
        return operation

    def _trim(self) -> None:
        if len(self._by_operation) <= 2048:
            return
        for operation_id, operation in tuple(self._by_operation.items()):
            if operation.terminal:
                self._by_operation.pop(operation_id, None)
                self._operation_by_trace.pop(operation.trace_id, None)
                if len(self._by_operation) <= 1536:
                    break


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
