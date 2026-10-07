"""Persistence port for cognition planning decisions."""

from __future__ import annotations

from typing import Protocol

from glimmer_cradle.cognition.planning.commitment import Commitment
from glimmer_cradle.cognition.planning.goal import Goal
from glimmer_cradle.cognition.planning.plan import ActionPlan, PlanVersion
from glimmer_cradle.cognition.ports.job_port import JobReceipt, JobRequest


class PlanningConflictError(ValueError):
    """持久语义、版本或请求身份冲突；不能把冲突当新工作重试。"""


class PlanningStore(Protocol):
    async def connect(self) -> None: ...

    async def close(self) -> None: ...

    async def record(self, goal: Goal, plan: ActionPlan) -> int: ...

    async def latest(self, *, trace_id: str) -> tuple[Goal, ActionPlan] | None: ...

    async def accept_commitment(
        self, commitment_id: str, plan: PlanVersion, *, due_at: int
    ) -> Commitment: ...

    async def load_commitment(self, commitment_id: str) -> Commitment | None: ...

    async def load_plan(self, plan_id: str, version: int) -> PlanVersion | None: ...

    async def pending_job_requests(self, *, limit: int = 64) -> list[JobRequest]: ...

    async def acknowledge_job_request(
        self, request: JobRequest, receipt: JobReceipt
    ) -> None: ...
