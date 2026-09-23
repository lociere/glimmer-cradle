"""Durable checkpoint contract for the native cognition loop."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class LoopCheckpoint:
    checkpoint_key: str
    cycle_count: int
    status: str
    revision: int
    updated_at: str = ""


class LoopCheckpointStore(Protocol):
    async def connect(self) -> None: ...

    async def close(self) -> None: ...

    async def load(self, checkpoint_key: str) -> LoopCheckpoint | None: ...

    async def save(
        self, checkpoint: LoopCheckpoint, *, expected_revision: int
    ) -> LoopCheckpoint: ...
