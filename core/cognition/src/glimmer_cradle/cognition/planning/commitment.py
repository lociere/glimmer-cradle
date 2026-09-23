"""Durable commitment state produced after an accepted plan."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


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
    expected_revision: int = 0
