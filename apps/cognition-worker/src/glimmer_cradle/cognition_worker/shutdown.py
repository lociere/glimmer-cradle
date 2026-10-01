"""Idempotent ordered shutdown coordination."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

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
            except Exception as error:
                failures.append((name, error))
        return tuple(failures)
