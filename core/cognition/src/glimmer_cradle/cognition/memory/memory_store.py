"""Persistence ports owned by the Memory domain."""

from __future__ import annotations

from typing import Protocol

import numpy as np


class MemoryStore(Protocol):
    async def all_current(self) -> list[dict]: ...

    async def create_revisions(self, drafts: list[dict]) -> list[str]: ...


class VectorIndexStore(Protocol):
    async def get_vectors(self, owner_kind: str, model: str) -> dict[str, np.ndarray]: ...

    async def upsert_vector(
        self, *, owner_kind: str, owner_id: str, model: str, vector: np.ndarray
    ) -> None: ...
