"""独立于认知循环的投影与记忆维护调度。"""

from __future__ import annotations

import asyncio
from collections.abc import Callable

from glimmer_cradle.cognition.experience.events import Moment, MomentKind
from glimmer_cradle.cognition.memory.consolidation import ConsolidationCoordinator
from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.observability.metrics import counter, gauge
from glimmer_cradle.cognition.observability.tracer import span

logger = get_logger("maintenance_scheduler")


class MaintenanceScheduler:
    """按独立节拍维护 Episode 与 Memory；活动态只提供封口提示。"""

    def __init__(
        self,
        *,
        consolidation: ConsolidationCoordinator,
        activity_state_provider: Callable[[], str],
        interval_seconds: float = 300,
    ) -> None:
        self._consolidation = consolidation
        self._activity_state_provider = activity_state_provider
        self._interval_seconds = max(10.0, interval_seconds)
        self._wake_event = asyncio.Event()
        self._force_seal_requested = False
        self._pending_reason = "scheduled"
        self._running = False
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._running:
            return
        await self._consolidation.start()
        self._running = True
        if self._activity_state_provider() == "quiescent":
            self._force_seal_requested = True
            self._pending_reason = "quiescent_boundary"
        self._wake_event.set()
        self._task = asyncio.create_task(self._run_loop())
        gauge("cognition.maintenance.running", 1.0)
        logger.info(
            "认知维护调度器已启动",
            interval_seconds=self._interval_seconds,
        )

    async def stop(self) -> None:
        self._running = False
        self._wake_event.set()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self._consolidation.stop()
        gauge("cognition.maintenance.running", 0.0)
        logger.info("认知维护调度器已停止")

    def notify_activity_transition(self) -> None:
        """静息只触发一次 Episode 封口，不改变维护任务的 owner 或节拍。"""
        if self._activity_state_provider() != "quiescent":
            return
        self._force_seal_requested = True
        self._pending_reason = "quiescent_boundary"
        self._wake_event.set()

    def notify_moment(self, moment: Moment) -> None:
        """终结 Moment 只负责唤醒；sealed Episode 才是可恢复工作项。"""
        if moment.kind not in {MomentKind.REPLY.value, MomentKind.SILENCE.value}:
            return
        if not self._force_seal_requested:
            self._pending_reason = "interaction_completed"
        self._wake_event.set()

    async def run_once(
        self,
        *,
        force_seal: bool = False,
        reason: str = "scheduled",
    ) -> int:
        with span(
            "cognition_maintenance",
            attributes={"force_seal": force_seal, "reason": reason},
        ) as task_span:
            created = await self._consolidation.consolidate(force_seal=force_seal)
            task_span.set_attribute("memories_created", created)
            counter(
                "cognition.maintenance.run",
                labels={
                    "status": "success",
                    "reason": reason,
                },
            )
            counter("cognition.memories_consolidated", created)
            return created

    async def _run_loop(self) -> None:
        while self._running:
            try:
                try:
                    await asyncio.wait_for(
                        self._wake_event.wait(),
                        timeout=self._interval_seconds,
                    )
                except asyncio.TimeoutError:
                    pass
                self._wake_event.clear()
                force_seal = self._force_seal_requested
                reason = self._pending_reason
                self._force_seal_requested = False
                self._pending_reason = "scheduled"
                await self.run_once(force_seal=force_seal, reason=reason)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                counter(
                    "cognition.maintenance.run",
                    labels={"status": "error", "reason": "scheduled"},
                )
                logger.error(
                    "认知维护任务失败，等待下一次调度",
                    error=str(exc),
                    exc_info=True,
                )
