"""Explicit stop policy for bounded or continuous loop runs."""

import math
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class StopPolicy:
    max_steps: int = 8
    max_capability_calls: int = 8
    max_output_chars: int = 16_000
    max_duration_seconds: float = 120.0

    def __post_init__(self) -> None:
        if self.max_steps < 1:
            raise ValueError("max_steps must be positive")
        if self.max_capability_calls < 0:
            raise ValueError("max_capability_calls must be non-negative")
        if self.max_output_chars < 1:
            raise ValueError("max_output_chars must be positive")
        if not math.isfinite(self.max_duration_seconds) or self.max_duration_seconds <= 0:
            raise ValueError("max_duration_seconds must be finite and positive")

    def stop_reason(
        self,
        *,
        step_count: int,
        capability_calls: int,
        output_chars: int,
    ) -> str | None:
        if step_count >= self.max_steps:
            return "step_limit"
        if capability_calls > self.max_capability_calls:
            return "capability_call_limit"
        if output_chars >= self.max_output_chars:
            return "output_limit"
        return None
