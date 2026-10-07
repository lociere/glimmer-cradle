"""Knowledge 专属持久边界；派生 embedding 不拥有来源事实。"""

from __future__ import annotations

from typing import Protocol

import numpy as np
from glimmer_cradle.cognition.knowledge.revision import KnowledgeRevision


class KnowledgeConflictError(ValueError):
    """来源、修订或库版本冲突；禁止以重建覆盖不可再生事实。"""


class KnowledgeStore(Protocol):
    async def get_all_entries(self) -> list[dict]: ...

    async def replace_config_entries(self, entries: list[dict]) -> None: ...

    async def delete_entry(
        self, entry_id: str, *, expected_revision: int, source: str
    ) -> int: ...

    async def get_embeddings(
        self, *, model: str, transformation_version: str
    ) -> dict[KnowledgeRevision, np.ndarray]: ...

    async def upsert_embedding(
        self,
        reference: KnowledgeRevision,
        *,
        model: str,
        transformation_version: str,
        vector: np.ndarray,
    ) -> None: ...
