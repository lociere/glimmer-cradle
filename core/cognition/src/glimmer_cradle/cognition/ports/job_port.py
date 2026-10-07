"""Consumer-owned port for durable long-running work requests."""

from __future__ import annotations

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
