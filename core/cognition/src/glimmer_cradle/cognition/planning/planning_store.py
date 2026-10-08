"""Persistence port for long-term planning and read-only decision history."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from glimmer_cradle.cognition.planning.commitment import (
    Commitment,
    PlanningEvaluationReceipt,
    PlanningJobFeedback,
    PlanningJobIdentity,
    PlanningJobResult,
    PlanningNotificationRequest,
)
from glimmer_cradle.cognition.planning.goal import GoalVersion, PlanningAssessment
from glimmer_cradle.cognition.planning.plan import PlanVersion
from glimmer_cradle.cognition.ports.job_port import (
    JobReceipt,
    JobRequest,
    PlanningEvidence,
    PlanningEvidenceReference,
)


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


@dataclass(frozen=True, slots=True)
class PlanningEvaluationWork:
    request_id: str
    commitment: Commitment
    plan: PlanVersion


@dataclass(frozen=True, slots=True)
class PlanningNotificationWork:
    """只读业务事实；App 还须复验实际来源、完整隐私域与真实投递 receiver。"""

    request: PlanningNotificationRequest
    goal: GoalVersion
    receipt: PlanningEvaluationReceipt


class PlanningCompletionEvaluator(Protocol):
    """Cognition 内部语义策略；外部模型需求另由既有 ModelPort 拥有。"""

    async def assess(self, work: PlanningEvaluationWork, evidence: tuple[PlanningEvidence, ...]) -> PlanningAssessment: ...


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

    async def read_evaluation_work(self, *, job_id: str, scope_id: str, request_id: str) -> PlanningEvaluationWork: ...

    async def accept_job_feedback(self, feedback: PlanningJobFeedback, result: dict | None) -> bool: ...

    async def pending_notification_requests(
        self, *, limit: int = 64, after_notification_id: str | None = None,
    ) -> list[PlanningNotificationRequest]: ...

    async def read_notification_work(self, request: PlanningNotificationRequest) -> PlanningNotificationWork: ...

    async def prepare_evaluation(
        self, identity: PlanningJobIdentity, request_id: str
    ) -> PlanningEvaluationWork | PlanningEvaluationReceipt: ...

    async def commit_evaluation(
        self, identity: PlanningJobIdentity, work: PlanningEvaluationWork,
        assessment: PlanningAssessment, evidence: tuple[PlanningEvidenceReference, ...],
    ) -> PlanningEvaluationReceipt: ...

    async def reconcile_evaluation(
        self, identity: PlanningJobIdentity, request_id: str
    ) -> PlanningJobResult: ...
