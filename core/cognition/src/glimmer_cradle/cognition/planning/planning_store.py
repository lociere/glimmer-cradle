"""Persistence port for cognition planning decisions."""

from __future__ import annotations

from typing import Protocol

from glimmer_cradle.cognition.planning.goal import Goal
from glimmer_cradle.cognition.planning.plan import ActionPlan


class PlanningStore(Protocol):
    async def connect(self) -> None: ...

    async def close(self) -> None: ...

    async def record(self, goal: Goal, plan: ActionPlan) -> int: ...

    async def latest(self, *, trace_id: str) -> tuple[Goal, ActionPlan] | None: ...
