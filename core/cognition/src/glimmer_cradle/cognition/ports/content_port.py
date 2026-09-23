"""Consumer-owned access to committed Content assets."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class ContentReference:
    asset_id: str
    media_type: str
    size_bytes: int
    sha256: str


class ContentPort(Protocol):
    async def read(self, reference: ContentReference, *, max_bytes: int) -> bytes: ...
