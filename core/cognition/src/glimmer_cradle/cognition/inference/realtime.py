"""Realtime inference session ordering and cancellation."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from glimmer_cradle.cognition.inference.event import ModelEvent, ModelEventKind


class RealtimeState(StrEnum):
    ACTIVE = "active"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


@dataclass(slots=True)
class RealtimeSession:
    session_id: str
    generation: int
    state: RealtimeState = RealtimeState.ACTIVE
    last_sequence: int = -1
    events: list[ModelEvent] = field(default_factory=list)

    def accept(self, event: ModelEvent) -> None:
        if self.state != RealtimeState.ACTIVE:
            raise RuntimeError("realtime session is terminal")
        if event.sequence <= self.last_sequence:
            raise ValueError("realtime event sequence must increase")
        self.last_sequence = event.sequence
        self.events.append(event)
        if event.kind == ModelEventKind.COMPLETED:
            self.state = RealtimeState.COMPLETED
        elif event.kind == ModelEventKind.FAILED:
            self.state = RealtimeState.FAILED

    def cancel(self, generation: int) -> bool:
        if generation != self.generation or self.state != RealtimeState.ACTIVE:
            return False
        self.state = RealtimeState.CANCELLED
        return True
