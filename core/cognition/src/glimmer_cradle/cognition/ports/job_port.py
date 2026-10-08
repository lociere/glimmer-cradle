"""Consumer-owned port for durable long-running work requests."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Literal, Protocol


@dataclass(frozen=True, slots=True)
class JobRequest:
    request_id: str
    goal_id: str
    kind: str
    payload: dict[str, object] = field(default_factory=dict)
    idempotency_key: str = ""
    scope_id: str = ""
    due_at: int = 0


JobRequestStatus = Literal["accepted", "duplicate", "rejected"]


@dataclass(frozen=True, slots=True)
class JobReceipt:
    job_id: str
    status: JobRequestStatus
    revision: int


class JobPort(Protocol):
    async def request(self, request: JobRequest) -> JobReceipt: ...

    async def cancel(self, job_id: str, *, expected_revision: int) -> JobReceipt: ...


@dataclass(frozen=True, slots=True)
class PlanningEvidenceReference:
    """真实 source 的有权限修订引用；模型不能自行创建或升级它。"""

    evidence_id: str
    source_owner: str
    scope_id: str
    revision: int
    content_digest: str

    def __post_init__(self) -> None:
        if self.source_owner not in {"conversation", "knowledge", "execution"}:
            raise ValueError("Planning 证据 owner 无效")
        for value in (self.evidence_id, self.scope_id):
            if not isinstance(value, str) or not value.strip() or len(value.encode("utf-8")) > 4096:
                raise ValueError("Planning 证据身份无效")
        if type(self.revision) is not int or not 1 <= self.revision <= 2**53 - 1:
            raise ValueError("Planning 证据修订无效")
        if not isinstance(self.content_digest, str) or not re.fullmatch(r"[a-f0-9]{64}", self.content_digest):
            raise ValueError("Planning 证据摘要无效")


@dataclass(frozen=True, slots=True)
class PlanningEvidence:
    """仅作为 untrusted/data 传给评估器；receipt 不复制正文。"""

    reference: PlanningEvidenceReference
    text: str

    def __post_init__(self) -> None:
        if not isinstance(self.reference, PlanningEvidenceReference) or not isinstance(self.text, str):
            raise TypeError("Planning 证据必须有来源引用和文本")
        body = self.text.encode("utf-8")
        if not body or len(body) > 16_384 or hashlib.sha256(body).hexdigest() != self.reference.content_digest:
            raise ValueError("Planning 证据内容/摘要/预算无效")


class PlanningEvidencePort(Protocol):
    """Planning Job 的消费方需求；App 从实际 owner 收集并复验 scope/修订/hash/权限。"""

    async def collect(self, *, goal_id: str, goal_version: int, scope_id: str, completion_condition: str,
                      source_moment_id: str | None = None, source_digest: str | None = None,
                      model_tier: str | None = None) -> tuple[PlanningEvidence, ...]: ...

    async def is_current(self, reference: PlanningEvidenceReference) -> bool: ...
