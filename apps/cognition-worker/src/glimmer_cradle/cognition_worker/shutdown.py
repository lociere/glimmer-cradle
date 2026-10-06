"""Worker 有序停机图；重复或取消等待不重复释放资源。"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from glimmer_cradle.cognition_worker.composition import CognitionComponents

ShutdownStep = tuple[str, Callable[[], Awaitable[None]]]


class ShutdownCoordinator:
    def __init__(self, *steps: ShutdownStep) -> None:
        self._steps = steps
        self._task: asyncio.Task[tuple[tuple[str, Exception], ...]] | None = None

    async def run(self) -> tuple[tuple[str, Exception], ...]:
        if self._task is None:
            self._task = asyncio.create_task(self._run_once())
        return await asyncio.shield(self._task)

    async def _run_once(self) -> tuple[tuple[str, Exception], ...]:
        failures: list[tuple[str, Exception]] = []
        for name, step in self._steps:
            try:
                await step()
            except Exception as error:  # noqa: BLE001 — 单步失败不能中止其余资源回收
                failures.append((name, error))
        return tuple(failures)


async def cancel_task(task: asyncio.Task | None) -> None:
    if task is None:
        return
    if not task.done():
        task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


def worker_shutdown_steps(
    components: CognitionComponents | None,
    *,
    stop_main: Callable[[], Awaitable[None]],
    stop_rpc: Callable[[], Awaitable[None]],
    stop_kernel: Callable[[], Awaitable[None]],
    stop_metrics: Callable[[], Awaitable[None]],
    stop_tracer: Callable[[], Awaitable[None]],
) -> tuple[ShutdownStep, ...]:
    steps: list[ShutdownStep] = [("main_loop", stop_main), ("rpc_service", stop_rpc)]
    if components is not None:

        async def sleep_character() -> None:
            components.character_session.sleep()

        # 先停生产者；Log 可读时封口 Episode 与 History，最后关闭单写者及领域库。
        steps.extend(
            (
                ("cognition_loop", components.cycle_controller.stop),
                ("character", sleep_character),
                ("activity", components.activity_controller.stop),
                ("maintenance", components.maintenance_scheduler.stop),
                ("conversation_history", components.conversation_controller.close),
                ("conversation_turns", components.turn_controller.close),
                ("conversation_log", components.conversation_recorder.stop),
                ("memory_store", components.cognition_database.close),
                ("checkpoint_store", components.checkpoint_store.close),
                ("knowledge_store", components.knowledge_store.close),
                ("planning_store", components.planning_store.close),
                ("state_store", components.state_store.close),
            )
        )
    # 即使 composition 失败，也关闭已创建的 transport 与启动期遥测。
    # 遥测最后关闭，保留其前所有回收失败的诊断。
    steps.extend(
        (
            ("kernel_client", stop_kernel),
            ("metrics", stop_metrics),
            ("tracer", stop_tracer),
        )
    )
    return tuple(steps)
