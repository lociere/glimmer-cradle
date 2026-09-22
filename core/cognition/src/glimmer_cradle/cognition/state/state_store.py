"""Persistence contract for versioned Cognition state snapshots."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class StoredCognitiveState:
    state_key: str
    revision: int
    payload: dict[str, object]
    updated_at: str


class StateStore(Protocol):
    async def connect(self) -> None: ...

    async def close(self) -> None: ...

    async def load(self, state_key: str) -> StoredCognitiveState | None: ...

    async def save(
        self,
        state: StoredCognitiveState,
        *,
        expected_revision: int | None,
    ) -> StoredCognitiveState: ...
