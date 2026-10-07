"""Durable Jobs client implementing Cognition's JobPort."""

from __future__ import annotations

import hashlib
import json
from typing import Protocol

from glimmer.cognition.v1 import cognition_service_pb2 as cognition_pb
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
