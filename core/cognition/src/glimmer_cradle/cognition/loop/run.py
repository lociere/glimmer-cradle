"""Native loop run outcome."""

from dataclasses import dataclass, field

from glimmer_cradle.cognition.ports.capability_port import CapabilityResult


@dataclass(frozen=True, slots=True)
class LoopRun:
    run_id: str
    status: str
    step_count: int = 0
    output: str = ""
    stop_reason: str = ""
    capability_results: tuple[CapabilityResult, ...] = field(default_factory=tuple)
