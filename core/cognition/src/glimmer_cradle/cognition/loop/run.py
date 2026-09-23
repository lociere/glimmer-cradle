"""Native loop run state."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class LoopRun:
    cycle_count: int = 0
    status: str = "stopped"
