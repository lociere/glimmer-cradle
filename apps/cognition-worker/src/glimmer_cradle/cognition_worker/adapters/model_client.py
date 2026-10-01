"""Streaming model client implementing Cognition's RealtimeModelPort."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from glimmer_cradle.cognition.inference import InferenceRequest, ModelEvent
from glimmer_cradle.cognition_worker.adapters.cognition_mapper import (
    inference_request_to_wire,
    model_event_from_wire,
)


class ModelTransport(Protocol):
    def stream(self, payload: dict[str, object]) -> AsyncIterator[dict[str, object]]: ...

    async def cancel(self, session_id: str) -> None: ...


class ModelClient:
    def __init__(self, transport: ModelTransport) -> None:
        self._transport = transport

    async def events(self, request: InferenceRequest) -> AsyncIterator[ModelEvent]:
        previous = -1
        async for raw in self._transport.stream(inference_request_to_wire(request)):
            event = model_event_from_wire(raw)
            if event.sequence <= previous:
                raise ValueError("model event sequence must increase")
            previous = event.sequence
            yield event

    async def cancel(self, session_id: str) -> None:
        await self._transport.cancel(session_id)
