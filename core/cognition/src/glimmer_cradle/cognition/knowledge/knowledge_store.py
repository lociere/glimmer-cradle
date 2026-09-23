"""Persistence port for curated Knowledge revisions."""

from __future__ import annotations

from typing import Protocol


class KnowledgeStore(Protocol):
    async def get_all_entries(self) -> list[dict]: ...

    async def replace_config_entries(self, entries: list[dict]) -> None: ...

    async def delete_entry(
        self, entry_id: str, *, expected_revision: int, source: str
    ) -> int: ...
