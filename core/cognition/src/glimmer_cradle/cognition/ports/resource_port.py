"""Consumer-owned access to versioned external resources."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True, slots=True)
class ResourceScope:
    # 全部缺省表示显式登记的 global IO；部分 context 不构成有效 scope。
    source_provider_id: str | None = None
    scene_id: str | None = None
    conversation_id: str | None = None


@dataclass(frozen=True, slots=True)
class ResourceAccess:
    access_id: str
    source_id: str
    principal_id: str
    permission_revision: str
    collected_at_ms: int
    expires_at_ms: int


@dataclass(frozen=True, slots=True)
class ResourceSnapshot:
    resource_id: str
    revision: str
    media_type: str
    content: bytes
    attributes: dict[str, object] = field(default_factory=dict)
    access: ResourceAccess | None = None


class ResourcePort(Protocol):
    async def read(
        self,
        resource_id: str,
        *,
        source_id: str,
        definition_revision: str,
        principal_id: str,
        scope: ResourceScope,
    ) -> ResourceSnapshot: ...

    async def is_current(
        self, snapshot: ResourceSnapshot, *, principal_id: str, scope: ResourceScope
    ) -> bool: ...
