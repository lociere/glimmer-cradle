"""Explicit stop policy for bounded or continuous loop runs."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class StopPolicy:
    max_cycles: int | None = None

    def should_stop(self, cycle_count: int) -> bool:
        return self.max_cycles is not None and cycle_count >= self.max_cycles
