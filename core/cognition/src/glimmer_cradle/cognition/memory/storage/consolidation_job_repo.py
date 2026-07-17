"""长期记忆巩固任务的持久队列。"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from glimmer_cradle.cognition.experience.episodes import Episode
from glimmer_cradle.cognition.memory.storage.database import CognitionDatabase
from glimmer_cradle.cognition.memory.storage.memory_repo import now_iso


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass(frozen=True, slots=True)
class ConsolidationJob:
    job_id: str
    episode_id: str
    episode_version: int
    scene_id: str
    actor_id: str | None
    attempt_count: int


class ConsolidationJobRepository:
    def __init__(self, database: CognitionDatabase) -> None:
        self._db = database

    async def recover_expired(self) -> None:
        await self._db.connection.execute(
            """
            UPDATE consolidation_jobs SET state='pending',lease_until=NULL
            WHERE state='claimed' AND lease_until<?
            """,
            (now_iso(),),
        )
        await self._db.connection.commit()

    async def enqueue(
        self, episode: Episode, *, debounce_seconds: int, max_wait_seconds: int
    ) -> None:
        now = datetime.now(timezone.utc)
        debounce_at = now + timedelta(seconds=debounce_seconds)
        deadline = _parse(episode.started_at) + timedelta(seconds=max_wait_seconds)
        available_at = _iso(min(debounce_at, deadline))
        job_id = uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"glimmer:memory-job:{episode.episode_id}:{episode.version}",
        ).hex
        timestamp = _iso(now)
        await self._db.connection.execute(
            """
            INSERT INTO consolidation_jobs(
              job_id,episode_id,episode_version,scene_id,actor_id,state,priority,
              available_at,policy_version,created_at
            ) VALUES(?,?,?,?,?,'pending',?,?,?,?)
            ON CONFLICT(episode_id) DO UPDATE SET
              episode_version=excluded.episode_version,
              scene_id=excluded.scene_id,
              actor_id=excluded.actor_id,
              priority=MAX(consolidation_jobs.priority,excluded.priority),
              available_at=MIN(consolidation_jobs.available_at,excluded.available_at),
              state=CASE WHEN consolidation_jobs.state='completed' THEN 'completed' ELSE 'pending' END
            """,
            (
                job_id, episode.episode_id, episode.version, episode.scene_id,
                episode.actor_id, episode.salience, available_at, "memory-policy-v2", timestamp,
            ),
        )
        await self._db.connection.commit()

    async def claim_due(self, *, limit: int, lease_seconds: int) -> list[ConsolidationJob]:
        conn = self._db.connection
        now = datetime.now(timezone.utc)
        lease_until = _iso(now + timedelta(seconds=lease_seconds))
        await conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = await conn.execute(
                """
                SELECT job_id,episode_id,episode_version,scene_id,actor_id,attempt_count
                FROM consolidation_jobs
                WHERE state IN ('pending','failed') AND available_at<=?
                ORDER BY priority DESC,available_at LIMIT ?
                """,
                (_iso(now), limit),
            )
            rows = await cursor.fetchall()
            if rows:
                await conn.executemany(
                    """
                    UPDATE consolidation_jobs
                    SET state='claimed',lease_until=?,started_at=?,attempt_count=attempt_count+1,
                        error_code=NULL WHERE job_id=?
                    """,
                    [(lease_until, _iso(now), row[0]) for row in rows],
                )
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise
        return [ConsolidationJob(*row) for row in rows]

    async def complete(self, jobs: list[ConsolidationJob]) -> None:
        if not jobs:
            return
        timestamp = now_iso()
        await self._db.connection.executemany(
            """
            UPDATE consolidation_jobs
            SET state='completed',lease_until=NULL,completed_at=?,error_code=NULL
            WHERE job_id=?
            """,
            [(timestamp, job.job_id) for job in jobs],
        )
        await self._db.connection.commit()

    async def fail(
        self, jobs: list[ConsolidationJob], *, error_code: str, retry_base_seconds: int
    ) -> None:
        if not jobs:
            return
        now = datetime.now(timezone.utc)
        values = []
        for job in jobs:
            delay = retry_base_seconds * (2 ** min(job.attempt_count, 6))
            values.append((_iso(now + timedelta(seconds=delay)), error_code, job.job_id))
        await self._db.connection.executemany(
            """
            UPDATE consolidation_jobs
            SET state='failed',available_at=?,lease_until=NULL,error_code=? WHERE job_id=?
            """,
            values,
        )
        await self._db.connection.commit()
