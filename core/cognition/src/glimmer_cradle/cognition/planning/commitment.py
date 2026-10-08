"""Durable commitment state produced after an accepted plan."""

from __future__ import annotations

import hashlib
import json
import re
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


@dataclass(frozen=True, slots=True)
class PlanningNotificationRequest:
    """完成事实的持久发布意图；引用不是目的地、发送权限或送达证明。"""

    notification_id: str
    receipt_id: str
    job_id: str
    request_id: str
    commitment_id: str
    commitment_revision: int
    goal_id: str
    goal_version: int
    scope_id: str
    source_moment_id: str | None
    source_digest: str | None
    created_at: int

    def __post_init__(self) -> None:
        if any(not isinstance(value, str) or not value.strip()
               for value in (self.commitment_id, self.goal_id, self.scope_id)):
            raise ValueError("Planning 通知语义身份无效")
        if any(not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value)
               for value in (self.notification_id, self.receipt_id, self.request_id)):
            raise ValueError("Planning 通知持久身份无效")
        receipt_id = hashlib.sha256(f"planning-evaluation.v1:{self.request_id}".encode()).hexdigest()
        notification_id = hashlib.sha256(f"planning-completion.v1:{receipt_id}".encode()).hexdigest()
        if self.receipt_id != receipt_id or self.notification_id != notification_id or self.job_id != f"planning:{self.request_id}":
            raise ValueError("Planning 通知/receipt/Job 身份冲突")
        if (type(self.commitment_revision) is not int or not 2 <= self.commitment_revision <= 2**53 - 1
            or type(self.goal_version) is not int or not 1 <= self.goal_version <= 2**53 - 1
            or type(self.created_at) is not int or not 0 <= self.created_at <= 2**53 - 1):
            raise ValueError("Planning 通知版本/时钟无效")
        if (self.source_moment_id is not None or self.source_digest is not None) and (
            not isinstance(self.source_moment_id, str) or not self.source_moment_id.strip()
            or len(self.source_moment_id.encode("utf-8")) > 4096
            or not isinstance(self.source_digest, str) or not re.fullmatch(r"[a-f0-9]{64}", self.source_digest)
        ):
            raise ValueError("Planning 通知来源绑定无效")


@dataclass(frozen=True, slots=True)
class PlanningJobFeedback:
    """Planning 消费方状态输入；不拥有 Jobs 调度，不从外部状态推断目标完成。"""

    request_id: str
    job_id: str
    goal_id: str
    scope_id: str
    event_id: str
    event_digest: str
    revision: int
    status: str
    attempt: int
    fencing_token: int
    job_epoch: int
    delivery_epoch: int
    updated_at: int

    def __post_init__(self) -> None:
        if any(not isinstance(value, str) or not value.strip() or len(value.encode("utf-8")) > 4096
               for value in (self.request_id, self.job_id, self.goal_id, self.scope_id, self.event_id, self.event_digest)):
            raise ValueError("Planning 状态身份/预算无效")
        if not re.fullmatch(r"[a-f0-9]{64}", self.request_id) or self.job_id != f"planning:{self.request_id}" \
                or not re.fullmatch(r"[a-f0-9]{64}", self.event_digest):
            raise ValueError("Planning 状态源身份/摘要无效")
        if any(type(value) is not int or not 1 <= value <= 2**53 - 1
               for value in (self.revision, self.job_epoch, self.delivery_epoch)) \
                or any(type(value) is not int or not 0 <= value <= 2**53 - 1
                       for value in (self.attempt, self.fencing_token, self.updated_at)):
            raise ValueError("Planning 状态整数无效")
        expected = hashlib.sha256(json.dumps([self.job_id, self.revision], ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
        if self.event_id != expected or self.status not in {"queued", "running", "retry_wait", "succeeded", "cancelled", "dead_letter", "unknown"} \
                or self.status in {"running", "retry_wait", "succeeded", "unknown"} and (not self.attempt or not self.fencing_token):
            raise ValueError("Planning 状态事件/执行身份无效")
