"""从 Experience Ledger 重建认知活动所需的最近活动时间线。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from glimmer_cradle.cognition.experience.events import MomentKind
from glimmer_cradle.cognition.experience.recorder import ExperienceRecorder


@dataclass(frozen=True)
class ActivityHistory:
    direct_at: datetime | None = None
    observed_at: datetime | None = None
    self_at: datetime | None = None

    @property
    def has_activity(self) -> bool:
        return any((self.direct_at, self.observed_at, self.self_at))


def parse_iso_ms(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


def project_activity_history(recorder: ExperienceRecorder) -> ActivityHistory:
    """从角色实际经历重建三条活动时间线，不读取调度 transition。"""
    direct_at: datetime | None = None
    observed_at: datetime | None = None
    self_at: datetime | None = None
    kinds = {
        MomentKind.PERCEPTION.value,
        MomentKind.REPLY.value,
        MomentKind.ACTION.value,
    }
    for moment in recorder.recent_moments(limit=2000, kinds=kinds):
        try:
            occurred_at = parse_iso_ms(moment.occurred_at)
        except ValueError:
            continue
        if moment.kind == MomentKind.PERCEPTION.value:
            if observed_at is None or occurred_at > observed_at:
                observed_at = occurred_at
            content = moment.content if isinstance(moment.content, dict) else {}
            if content.get("address_mode") == "direct":
                if direct_at is None or occurred_at > direct_at:
                    direct_at = occurred_at
        elif moment.kind in {MomentKind.REPLY.value, MomentKind.ACTION.value}:
            if self_at is None or occurred_at > self_at:
                self_at = occurred_at
    return ActivityHistory(direct_at, observed_at, self_at)


def compute_idle_seconds(now: datetime, last_at: datetime | None) -> float:
    if last_at is None:
        return float("inf")
    if last_at.tzinfo is None:
        last_at = last_at.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return max(0.0, (now - last_at).total_seconds())
