"""受 Cognition 生命周期监督的感知操作终态登记。"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass


TERMINAL_STATES = frozenset({"succeeded", "cancelled", "failed"})


@dataclass(slots=True)
class PerceptionOperation:
    operation_id: str
    trace_id: str
    state: str = "accepted"
    safe_message: str = ""
    task: asyncio.Task | None = None

    @property
    def terminal(self) -> bool:
        return self.state in TERMINAL_STATES


class PerceptionOperationRegistry:
    """把 transport ACK 绑定到实际 Cycle task，而不是只跟踪 RPC task。"""

    def __init__(self) -> None:
        self._by_operation: dict[str, PerceptionOperation] = {}
        self._operation_by_trace: dict[str, str] = {}

    def accept(self, operation_id: str, trace_id: str) -> tuple[PerceptionOperation, bool]:
        existing_id = self._operation_by_trace.get(trace_id)
        if existing_id is not None:
            return self._by_operation[existing_id], True
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

    def finish(self, trace_id: str, state: str, safe_message: str = "") -> None:
        operation = self.get_by_trace(trace_id)
        if operation is not None and not operation.terminal:
            operation.state = state
            operation.safe_message = safe_message
            operation.task = None

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
