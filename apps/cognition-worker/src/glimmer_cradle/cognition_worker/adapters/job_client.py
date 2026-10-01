"""Durable Jobs client implementing Cognition's JobPort."""

from __future__ import annotations

from glimmer_cradle.cognition.ports import JobReceipt, JobRequest
from glimmer_cradle.cognition_worker.adapters.capability_client import RequestTransport


class JobClient:
    def __init__(self, transport: RequestTransport) -> None:
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
            },
        )
        return self._receipt(response)

    async def cancel(self, job_id: str, *, expected_revision: int) -> JobReceipt:
        return self._receipt(await self._transport.request(
            "job.cancel", {"job_id": job_id, "expected_revision": expected_revision}
        ))

    @staticmethod
    def _receipt(response: dict[str, object]) -> JobReceipt:
        job_id, status, revision = (
            response.get("job_id"), response.get("status"), response.get("revision")
        )
        if not isinstance(job_id, str) or status not in {"accepted", "duplicate", "rejected"}:
            raise ValueError("invalid job receipt")
        if not isinstance(revision, int) or revision < 0:
            raise ValueError("invalid job revision")
        return JobReceipt(job_id, status, revision)  # type: ignore[arg-type]
