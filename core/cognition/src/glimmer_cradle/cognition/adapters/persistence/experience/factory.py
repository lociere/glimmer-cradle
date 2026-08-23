"""Experience 持久化 Adapter 的组装辅助。"""

from __future__ import annotations

from pathlib import Path

from glimmer_cradle.cognition.application.experience.recorder import ExperienceRecorder
from glimmer_cradle.cognition.adapters.persistence.experience.ledger import ExperienceLedger
from glimmer_cradle.cognition.ports.clock import ClockPort
from glimmer_cradle.cognition.ports.identity import IdGeneratorPort
from glimmer_cradle.cognition.ports.observability import ObservabilityPort


def build_experience_recorder(
    base_dir: Path,
    *,
    enabled: bool = True,
    pack_max_size_mb: int = 256,
    flush_interval_ms: int = 500,
    flush_max_buffer: int = 64,
    clock: ClockPort,
    ids: IdGeneratorPort,
    observability: ObservabilityPort,
) -> ExperienceRecorder:
    ledger = ExperienceLedger(base_dir, pack_max_size_mb=pack_max_size_mb)
    return ExperienceRecorder(
        ledger,
        clock=clock,
        ids=ids,
        observability=observability,
        enabled=enabled,
        flush_interval_ms=flush_interval_ms,
        flush_max_buffer=flush_max_buffer,
    )
