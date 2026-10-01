"""Business-readiness state for the supervised Cognition Worker."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class ReadinessTracker:
    required: frozenset[str]
    ready: set[str] = field(default_factory=set)
    degraded: dict[str, str] = field(default_factory=dict)

    def mark_ready(self, component: str) -> None:
        if component not in self.required:
            raise ValueError(f"unknown readiness component: {component}")
        self.ready.add(component)
        self.degraded.pop(component, None)

    def mark_degraded(self, component: str, reason: str) -> None:
        if component not in self.required:
            raise ValueError(f"unknown readiness component: {component}")
        self.ready.discard(component)
        self.degraded[component] = reason

    @property
    def is_ready(self) -> bool:
        return self.ready == set(self.required) and not self.degraded

    @property
    def missing(self) -> frozenset[str]:
        return self.required.difference(self.ready)
