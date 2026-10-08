"""Durable Jobs client implementing Cognition's JobPort."""

from __future__ import annotations

import hashlib
import json
from typing import Protocol

from glimmer.cognition.v1 import cognition_service_pb2 as cognition_pb
from glimmer.jobs.v1 import jobs_pb2 as jobs_pb
from glimmer_cradle.cognition.planning import PlanningJobIdentity, PlanningJobResult
from glimmer_cradle.cognition.ports import JobReceipt, JobRequest


class JobRequestTransport(Protocol):
    async def request(
        self, method: str, payload: dict[str, object]
    ) -> dict[str, object]: ...


class JobClient:
    def __init__(self, transport: JobRequestTransport) -> None:
        self._transport = transport

    async def request(self, request: JobRequest) -> JobReceipt:
        response = await self._transport.request(
            "job.request",
            {
                "request_id": request.request_id,
                "goal_id": request.goal_id,
                "kind": request.kind,
                "payload": request.payload,
                "idempotency_key": request.idempotency_key,
                "scope_id": request.scope_id,
                "due_at": request.due_at,
            },
        )
        return self._receipt(response)

    async def cancel(self, job_id: str, *, expected_revision: int) -> JobReceipt:
        return self._receipt(
            await self._transport.request(
                "job.cancel", {"job_id": job_id, "expected_revision": expected_revision}
            )
        )

    @staticmethod
    def _receipt(response: dict[str, object]) -> JobReceipt:
        job_id, status, revision = (
            response.get("job_id"),
            response.get("status"),
            response.get("revision"),
        )
        if not isinstance(job_id, str) or status not in {
            "accepted",
            "duplicate",
            "rejected",
        }:
            raise ValueError("invalid job receipt")
        if not isinstance(revision, int) or revision < 0:
            raise ValueError("invalid job revision")
        return JobReceipt(job_id, status, revision)  # type: ignore[arg-type]


def planning_source_from_wire(
    source: cognition_pb.PlanningJobSourceRequest,
) -> JobRequest:
    """映射唯一 DTO 到消费方请求；不向 Core 泄漏 generated。"""
    identity = json.dumps(
        [
            "planning.evaluate",
            source.commitment_id,
            source.plan_id,
            source.plan_version,
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    if (
        source.ByteSize() > 65536
        or any(
            not value.strip()
            for value in (
                source.commitment_id,
                source.plan_id,
                source.goal_id,
                source.scope_id,
            )
        )
        or not all(
            1 <= value <= 9007199254740991
            for value in (source.plan_version, source.goal_version)
        )
        or not 0 <= source.due_at_ms <= 9007199254740991
        or source.request_id != hashlib.sha256(identity.encode("utf-8")).hexdigest()
    ):
        raise ValueError("Planning 源请求 identity/版本/due 无效")
    return JobRequest(
        request_id=source.request_id,
        goal_id=source.goal_id,
        kind="planning.evaluate",
        payload={
            "commitment_id": source.commitment_id,
            "plan_id": source.plan_id,
            "plan_version": source.plan_version,
            "goal_version": source.goal_version,
        },
        idempotency_key=source.request_id,
        scope_id=source.scope_id,
        due_at=source.due_at_ms,
    )


def planning_source_to_wire(
    request: JobRequest,
) -> cognition_pb.PlanningJobSourceRequest:
    payload = request.payload
    if (
        set(payload) != {"commitment_id", "plan_id", "plan_version", "goal_version"}
        or not all(
            type(payload.get(key)) is int for key in ("plan_version", "goal_version")
        )
        or not all(
            isinstance(payload.get(key), str) for key in ("commitment_id", "plan_id")
        )
    ):
        raise ValueError("Planning 持久源内容无效")
    source = cognition_pb.PlanningJobSourceRequest(
        request_id=request.request_id,
        goal_id=request.goal_id,
        commitment_id=payload["commitment_id"],
        plan_id=payload["plan_id"],
        plan_version=payload["plan_version"],
        goal_version=payload["goal_version"],
        scope_id=request.scope_id,
        due_at_ms=request.due_at,
    )
    if planning_source_from_wire(source) != request:
        raise ValueError("Planning 持久源 kind/去重身份无效")
    return source


def planning_identity_from_wire(identity: jobs_pb.JobExecutionIdentity) -> PlanningJobIdentity:
    return PlanningJobIdentity(identity.job_id, identity.scope_id, identity.attempt,
                               identity.authority_epoch, identity.fencing_token,
                               identity.owner_id, identity.lease_until_ms)


def planning_identity_to_wire(identity: PlanningJobIdentity) -> jobs_pb.JobExecutionIdentity:
    return jobs_pb.JobExecutionIdentity(job_id=identity.job_id, scope_id=identity.scope_id,
        attempt=identity.attempt, authority_epoch=identity.authority_epoch,
        fencing_token=identity.fencing_token, owner_id=identity.owner_id,
        lease_until_ms=identity.lease_until)


def planning_result_to_wire(result: PlanningJobResult, request_id: str) -> cognition_pb.PlanningJobResult:
    """原查询 identity 与真实提交 identity 分开；新 attempt 不篡改旧业务 receipt。"""
    identity, receipt = result.identity, result.receipt
    resolution = "applied" if receipt is not None else "not_applied"
    document = ["planning-reconciliation.v1", identity.job_id, identity.scope_id,
        identity.attempt, identity.authority_epoch, identity.fencing_token, identity.owner_id,
        identity.lease_until, request_id, resolution, receipt.receipt_id if receipt else "sealed", result.observed_at]
    wire = cognition_pb.PlanningJobResult(identity=planning_identity_to_wire(identity),
        request_id=request_id, resolution=cognition_pb.PLANNING_JOB_RESOLUTION_APPLIED if receipt else cognition_pb.PLANNING_JOB_RESOLUTION_NOT_APPLIED,
        source_id="cognition.planning", receiver_fenced=result.receiver_fenced,
        evidence_id=hashlib.sha256(json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest(),
        observed_at_ms=result.observed_at)
    if receipt is not None:
        wire.receipt.CopyFrom(cognition_pb.PlanningEvaluationReceipt(receipt_id=receipt.receipt_id,
            identity=planning_identity_to_wire(receipt.identity), request_id=receipt.request_id,
            commitment_id=receipt.commitment_id, commitment_revision=receipt.commitment_revision,
            completed=receipt.assessment.completed, evidence_ids=receipt.assessment.evidence_ids,
            reason=receipt.assessment.reason, evidence=[cognition_pb.PlanningEvidenceReference(
                evidence_id=item.evidence_id, source_owner=item.source_owner, scope_id=item.scope_id,
                revision=item.revision, content_digest=item.content_digest) for item in receipt.evidence],
            committed_at_ms=receipt.committed_at))
    if wire.ByteSize() > 65_536:
        raise ValueError("Planning 对账响应超过预算")
    return wire
