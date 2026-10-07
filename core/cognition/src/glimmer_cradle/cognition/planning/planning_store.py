"""Persistence port for long-term planning and read-only decision history."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from glimmer_cradle.cognition.planning.commitment import Commitment
from glimmer_cradle.cognition.planning.plan import PlanVersion
from glimmer_cradle.cognition.ports.job_port import JobReceipt, JobRequest


@dataclass(frozen=True, slots=True)
class PlanningDecisionSnapshot:
    """旧 journal 的原始只读投影；字段不解释为当前能力、权限或行动。"""

    trace_id: str
    scene_id: str
    original_goal: str
    planned_goal: str
    action: str
    capability_kind: str
    reason: str
    confidence: float
    planning_hint: str | None


class PlanningConflictError(ValueError):
    """持久语义、版本或请求身份冲突；不能把冲突当新工作重试。"""


class PlanningStore(Protocol):
    async def connect(self) -> None: ...

    async def close(self) -> None: ...

    async def latest_decision_snapshot(
        self, *, trace_id: str
    ) -> PlanningDecisionSnapshot | None: ...

    async def accept_commitment(
        self, commitment_id: str, plan: PlanVersion, *, due_at: int
    ) -> Commitment: ...

    async def load_commitment(self, commitment_id: str) -> Commitment | None: ...

    async def load_plan(self, plan_id: str, version: int) -> PlanVersion | None: ...

    async def pending_job_requests(self, *, limit: int = 64) -> list[JobRequest]: ...

    async def acknowledge_job_request(
        self, request: JobRequest, receipt: JobReceipt
    ) -> None: ...
