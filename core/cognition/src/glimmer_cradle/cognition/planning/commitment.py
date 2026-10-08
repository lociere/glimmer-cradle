"""Durable commitment state produced after an accepted plan."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from glimmer_cradle.cognition.planning.goal import PlanningAssessment
from glimmer_cradle.cognition.ports.job_port import PlanningEvidenceReference


class CommitmentStatus(StrEnum):
    PROPOSED = "proposed"
    ACCEPTED = "accepted"
    COMPLETED = "completed"
    ABANDONED = "abandoned"


@dataclass(frozen=True, slots=True)
class Commitment:
    commitment_id: str
    plan_id: str
    status: CommitmentStatus
    revision: int
    plan_version: int


@dataclass(frozen=True, slots=True)
class PlanningJobIdentity:
    """消费方 attempt 身份；由可信 App 从 Jobs lease 映射，不授予平台权限。"""

    job_id: str
    scope_id: str
    attempt: int
    authority_epoch: int
    fencing_token: int
    owner_id: str
    lease_until: int

    def __post_init__(self) -> None:
        for value in (self.job_id, self.scope_id, self.owner_id):
            if not isinstance(value, str) or not value.strip() or len(value.encode("utf-8")) > 4096:
                raise ValueError("Planning Job 身份无效")
        for value in (self.attempt, self.authority_epoch, self.fencing_token, self.lease_until):
            if type(value) is not int or not 1 <= value <= 2**53 - 1:
                raise ValueError("Planning Job attempt/epoch/token/deadline 无效")


@dataclass(frozen=True, slots=True)
class PlanningEvaluationReceipt:
    receipt_id: str
    identity: PlanningJobIdentity
    request_id: str
    commitment_id: str
    commitment_revision: int
    assessment: PlanningAssessment
    evidence: tuple[PlanningEvidenceReference, ...]
    committed_at: int


@dataclass(frozen=True, slots=True)
class PlanningJobResult:
    identity: PlanningJobIdentity
    receipt: PlanningEvaluationReceipt | None
    receiver_fenced: bool
    observed_at: int
