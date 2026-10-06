"""Worker 启动条件与停机阶段的唯一就绪状态。"""

from __future__ import annotations

from dataclasses import dataclass, field

WORKER_READY_COMPONENTS = frozenset(
    {
        "conversation_log",
        "state_stores",
        "projections",
        "loop",
        "kernel_registration",
        "character",
        "initial_state_sync",
    }
)


@dataclass(slots=True)
class ReadinessTracker:
    required: frozenset[str]
    ready: set[str] = field(default_factory=set)
    degraded: dict[str, str] = field(default_factory=dict)
    phase: str = "binding"

    def begin_startup(self) -> None:
        self.ready.clear()
        self.degraded.clear()
        self.phase = "domain_starting"

    def begin_shutdown(self) -> None:
        self.ready.clear()
        self.phase = "stopping"

    def mark_stopped(self) -> None:
        self.ready.clear()
        self.phase = "stopped"

    def mark_ready(self, component: str) -> None:
        if component not in self.required:
            raise ValueError(f"unknown readiness component: {component}")
        if self.phase in {"stopping", "stopped"}:
            raise RuntimeError("Worker 停机后不能恢复 ready")
        self.ready.add(component)
        self.degraded.pop(component, None)
        if self.is_ready:
            self.phase = "ready"

    def mark_degraded(self, component: str, reason: str) -> None:
        if component not in self.required:
            raise ValueError(f"unknown readiness component: {component}")
        self.ready.discard(component)
        self.degraded[component] = reason
        if self.phase not in {"stopping", "stopped"}:
            self.phase = "degraded"

    @property
    def is_ready(self) -> bool:
        return (
            self.phase not in {"stopping", "stopped"}
            and self.ready == set(self.required)
            and not self.degraded
        )

    @property
    def state(self) -> str:
        if self.phase in {"stopping", "stopped"}:
            return self.phase
        if self.is_ready:
            return "ready"
        return "degraded" if self.degraded else "starting"

    @property
    def missing(self) -> frozenset[str]:
        return self.required.difference(self.ready)
