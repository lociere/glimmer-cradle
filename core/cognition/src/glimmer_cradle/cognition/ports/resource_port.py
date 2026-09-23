"""Consumer-owned access to versioned external resources."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True, slots=True)
class ResourceSnapshot:
    resource_id: str
    revision: str
    media_type: str
    content: bytes
    attributes: dict[str, object] = field(default_factory=dict)


class ResourcePort(Protocol):
    async def read(
        self,
        resource_id: str,
        *,
        revision: str | None,
        principal_id: str,
    ) -> ResourceSnapshot: ...
