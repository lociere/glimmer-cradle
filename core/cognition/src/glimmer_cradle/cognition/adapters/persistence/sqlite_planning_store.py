"""SQLite implementation of the Cognition planning journal."""

from __future__ import annotations

from pathlib import Path
from typing import cast

import aiosqlite

from glimmer_cradle.cognition.planning.goal import Goal
from glimmer_cradle.cognition.planning.plan import ActionPlan, CapabilityKind, CognitiveAction


class SqlitePlanningStore:
    def __init__(self, path: Path, *, migration_path: Path | None = None) -> None:
        self._path = path
        self._migration_path = migration_path or (
            Path(__file__).resolve().parents[5] / "migrations" / "004-planning.sql"
        )
        self._connection: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        if self._connection is not None:
            return
        self._path.parent.mkdir(parents=True, exist_ok=True)
        connection = await aiosqlite.connect(self._path)
        connection.row_factory = aiosqlite.Row
        migration = self._migration_path.read_text(encoding="utf-8")
        await connection.executescript(migration)
        await connection.commit()
        self._connection = connection

    async def close(self) -> None:
        connection, self._connection = self._connection, None
        if connection is not None:
            await connection.close()

    async def record(self, goal: Goal, plan: ActionPlan) -> int:
        connection = self._require_connection()
        cursor = await connection.execute(
            """
            INSERT INTO planning_decision (
                trace_id, scene_id, original_goal, planned_goal, action,
                capability_kind, reason, confidence, planning_hint
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                goal.trace_id,
                goal.scene_id,
                plan.original_goal,
                plan.goal,
                plan.action,
                plan.capability_kind,
                plan.reason,
                plan.confidence,
                plan.planning_hint,
            ),
        )
        await connection.commit()
        return int(cursor.lastrowid or 0)

    async def latest(self, *, trace_id: str) -> tuple[Goal, ActionPlan] | None:
        connection = self._require_connection()
        cursor = await connection.execute(
            """
            SELECT trace_id, scene_id, original_goal, planned_goal, action,
                   capability_kind, reason, confidence, planning_hint
              FROM planning_decision
             WHERE trace_id = ?
             ORDER BY decision_id DESC
             LIMIT 1
            """,
            (trace_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        goal = Goal(
            text=str(row["original_goal"]),
            scene_id=str(row["scene_id"]),
            trace_id=str(row["trace_id"]),
        )
        plan = ActionPlan(
            action=cast(CognitiveAction, row["action"]),
            original_goal=str(row["original_goal"]),
            goal=str(row["planned_goal"]),
            capability_kind=cast(CapabilityKind, row["capability_kind"]),
            reason=str(row["reason"]),
            confidence=float(row["confidence"]),
            planning_hint=row["planning_hint"],
        )
        return goal, plan

    def _require_connection(self) -> aiosqlite.Connection:
        if self._connection is None:
            raise RuntimeError("Planning store is not connected")
        return self._connection
