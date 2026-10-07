"""Persistence ports owned by the Memory domain."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np
from glimmer_cradle.cognition.memory.memory import Episode


@dataclass(frozen=True, slots=True)
class ConsolidationJob:
    job_id: str
    episode_id: str
    episode_version: int
    scene_id: str
    actor_id: str | None
    attempt_count: int


@dataclass(frozen=True, slots=True)
class MemoryConsolidationInput:
    episode_id: str
    episode_version: int
    scope_id: str
    input_digest: str


@dataclass(frozen=True, slots=True)
class MemoryConsolidationRequest:
    """源投递身份；接纳回执不表示巩固结果或 Jobs 终态。"""

    request_id: str
    input: MemoryConsolidationInput
    created_at: str


@dataclass(frozen=True, slots=True)
class MemoryConsolidationReceipt:
    receipt_id: str
    operation_id: str
    scope_id: str
    memory_ids: tuple[str, ...]
    committed_at: str
    duplicate: bool = False


class MemoryConsolidationConflictError(ValueError):
    """持久巩固身份或输入发生冲突，不允许当新工作重放。"""


@dataclass(frozen=True, slots=True)
class MemoryJobIdentity:
    """消费方所需的原执行身份；App 从唯一 wire 契约映射，不引入 Jobs 内部对象。"""

    job_id: str
    scope_id: str
    attempt: int
    authority_epoch: int
    fencing_token: int
    owner_id: str
    lease_until: int


@dataclass(frozen=True, slots=True)
class MemoryJobResult:
    identity: MemoryJobIdentity
    receipt: MemoryConsolidationReceipt | None
    receiver_fenced: bool
    observed_at: int


@dataclass(frozen=True, slots=True)
class MemoryJobFeedback:
    """Memory 源所需的状态投影输入；非 wire DTO，不拥有 Jobs 状态或调度。"""

    request_id: str
    job_id: str
    scope_id: str
    event_id: str
    event_digest: str
    revision: int
    status: str
    job_epoch: int
    delivery_epoch: int
    updated_at: int


class EpisodeProjectionStore(Protocol):
    async def start(self) -> None: ...
    async def project_pending(self, *, seal: bool = False) -> int: ...
    def pending_consolidation(self, *, limit: int = 8) -> list[Episode]: ...
    def get_episode(self, episode_id: str) -> Episode | None: ...
    def recover_interrupted(self) -> None: ...
    def list_episodes(
        self, *, since_iso: str | None = None, limit: int = 100
    ) -> list[Episode]: ...
    def mark_consolidated(self, episode_id: str, consolidated_at: str) -> None: ...
    def pending_job_requests(self, *, limit: int = 64) -> list[MemoryConsolidationRequest]: ...
    def acknowledge_job_request(self, request: MemoryConsolidationRequest, job_id: str) -> None: ...
    def accepted_job_request(self, job_id: str) -> MemoryConsolidationRequest: ...
    def accept_job_feedback(self, feedback: MemoryJobFeedback, receipt_id: str | None) -> bool: ...


class ConsolidationJobStore(Protocol):
    async def recover_expired(self) -> None: ...
    async def enqueue(
        self,
        episode: Episode,
        *,
        debounce_seconds: int,
        max_wait_seconds: int,
    ) -> None: ...
    async def claim_due(
        self, *, limit: int, lease_seconds: int
    ) -> list[ConsolidationJob]: ...
    async def complete(self, jobs: list[ConsolidationJob]) -> None: ...
    async def fail(
        self,
        jobs: list[ConsolidationJob],
        *,
        error_code: str,
        retry_base_seconds: int,
    ) -> None: ...


class RelationshipProjectionStore(Protocol):
    async def project_pending(self) -> int: ...


class MemoryStore(Protocol):
    async def all_current(self) -> list[dict]: ...

    async def create_revisions(self, drafts: list[dict]) -> list[str]: ...

    async def find_consolidation(self, item: MemoryConsolidationInput) -> MemoryConsolidationReceipt | None: ...

    async def commit_consolidation(
        self, operation_id: str, inputs: tuple[MemoryConsolidationInput, ...], drafts: list[dict],
        *, execution: MemoryJobIdentity | None = None,
    ) -> MemoryConsolidationReceipt: ...

    async def prepare_job(self, identity: MemoryJobIdentity, operation_id: str,
                          inputs: tuple[MemoryConsolidationInput, ...]) -> MemoryConsolidationReceipt | None: ...

    async def reconcile_job(self, identity: MemoryJobIdentity) -> MemoryJobResult: ...


class VectorIndexStore(Protocol):
    async def get_vectors(self, owner_kind: str, model: str) -> dict[str, np.ndarray]: ...

    async def upsert_vector(
        self, *, owner_kind: str, owner_id: str, model: str, vector: np.ndarray
    ) -> None: ...
