"""当前认知 focus 的短租约。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True, slots=True)
class CognitiveAttentionLease:
    attention_id: str
    acquired_at: datetime
    expires_at: datetime

    @classmethod
    def acquire(
        cls,
        attention_id: str,
        *,
        now: datetime,
        duration_seconds: float,
    ) -> "CognitiveAttentionLease":
        if not attention_id.strip():
            raise ValueError("attention_id is required")
        if duration_seconds <= 0:
            raise ValueError("attention lease duration must be positive")
        return cls(
            attention_id=attention_id,
            acquired_at=now,
            expires_at=now + timedelta(seconds=duration_seconds),
        )

    def is_valid(self, now: datetime) -> bool:
        return now < self.expires_at
