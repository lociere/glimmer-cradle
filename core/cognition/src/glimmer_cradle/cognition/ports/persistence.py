"""Cognition 对持久化能力的外部 Port。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from glimmer_cradle.cognition.domain.experience.episode import Episode
from glimmer_cradle.cognition.domain.relationship import RelationshipRecord


@dataclass(frozen=True, slots=True)
class ConsolidationJob:
    job_id: str
    episode_id: str
    episode_version: int
    scene_id: str
    actor_id: str | None
    attempt_count: int


class EpisodeProjectionPort(Protocol):
    async def start(self) -> None: ...
    async def project_pending(self, *, seal: bool = False) -> int: ...
    def pending_consolidation(self, *, limit: int = 8) -> list[Episode]: ...
    def get_episode(self, episode_id: str) -> Episode | None: ...
    def recover_interrupted(self) -> None: ...
    def list_episodes(self, *, since_iso: str | None = None,
                      limit: int = 100) -> list[Episode]: ...
    def mark_consolidated(self, episode_id: str, consolidated_at: str) -> None: ...


class ConsolidationJobRepositoryPort(Protocol):
    async def recover_expired(self) -> None: ...
    async def enqueue(self, episode: Episode, *, debounce_seconds: int,
                      max_wait_seconds: int) -> None: ...
    async def claim_due(self, *, limit: int, lease_seconds: int) -> list[ConsolidationJob]: ...
    async def complete(self, jobs: list[ConsolidationJob]) -> None: ...
    async def fail(self, jobs: list[ConsolidationJob], *, error_code: str,
                   retry_base_seconds: int) -> None: ...


class RelationshipRepositoryPort(Protocol):
    async def get(self, actor_id: str) -> RelationshipRecord | None: ...
    async def observe(self, actor_id: str, *, kind: str,
                      evidence_moment_id: str,
                      display_name: str | None = None) -> RelationshipRecord: ...


class RelationshipProjectionPort(Protocol):
    async def project_pending(self) -> int: ...
