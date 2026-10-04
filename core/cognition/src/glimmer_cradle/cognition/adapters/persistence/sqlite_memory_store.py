"""SQLite transaction boundary for versioned Cognition memory."""

from __future__ import annotations

import json
from pathlib import Path
from datetime import datetime, timedelta, timezone
import sqlite3
from contextlib import closing
from typing import Any
import uuid

import aiosqlite
import numpy as np

from glimmer_cradle.cognition.adapters.paths import resolve_cognition_db_path, resolve_repo_root
from glimmer_cradle.cognition.ports import LoggerPort
from glimmer_cradle.cognition.memory import (
    ConsolidationJob,
    Episode,
    RelationshipRecord,
)
from glimmer_cradle.conversation import ConversationLogReaderPort, Moment, MomentKind

SCHEMA_VERSION = 3
_VECTOR_DTYPE = np.float32


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


class SqliteMemoryStore:
    """Own the SQLite connection shared by memory persistence projections."""

    def __init__(
        self,
        db_path: Path | None = None,
        *,
        migration_path: Path | None = None,
        logger: LoggerPort | None = None,
    ) -> None:
        self._db_path = db_path or resolve_cognition_db_path()
        self._migration_path = migration_path or (
            resolve_repo_root() / "core" / "cognition" / "migrations" / "002-memory.sql"
        )
        self._conn: aiosqlite.Connection | None = None
        self._logger = logger

    async def connect(self) -> None:
        if self._conn is not None:
            return
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = await aiosqlite.connect(str(self._db_path))
        await connection.execute("PRAGMA journal_mode=WAL")
        await connection.execute("PRAGMA foreign_keys=ON")
        cursor = await connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'"
        )
        if await cursor.fetchone() is None:
            await connection.executescript(self._migration_path.read_text(encoding="utf-8"))
            await connection.execute(
                "INSERT INTO schema_meta VALUES('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )
            await connection.commit()
        else:
            cursor = await connection.execute(
                "SELECT value FROM schema_meta WHERE key='schema_version'"
            )
            row = await cursor.fetchone()
            version = int(row[0]) if row is not None else 0
            if version != SCHEMA_VERSION:
                await connection.close()
                raise RuntimeError("检测到非当前记忆架构数据库；须先执行受控数据迁移")
        self._conn = connection
        if self._logger is not None:
            self._logger.info(
                "记忆事实库已就绪",
                db_path=str(self._db_path),
                schema_version=SCHEMA_VERSION,
            )

    async def close(self) -> None:
        connection, self._conn = self._conn, None
        if connection is not None:
            await connection.close()

    @property
    def connection(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("SqliteMemoryStore 尚未连接")
        return self._conn


class MemoryRepository:
    """版本化时间记忆仓库。"""

    def __init__(self, database: SqliteMemoryStore) -> None:
        self._db = database

    async def create_revision(
        self,
        *,
        memory_id: str | None,
        kind: str,
        content: str,
        summary: str,
        status: str,
        confidence: float,
        salience: float,
        actor_id: str | None,
        scene_id: str | None,
        conversation_id: str | None,
        continuity_id: str | None,
        recall_scope: str,
        disclosure_scope: str,
        attributes: dict[str, Any],
        evidence: list[dict[str, Any]],
        consolidation_id: str,
        valid_from: str | None = None,
    ) -> str:
        result = await self.create_revisions(
            [
                {
                    "memory_id": memory_id,
                    "kind": kind,
                    "content": content,
                    "summary": summary,
                    "status": status,
                    "confidence": confidence,
                    "salience": salience,
                    "actor_id": actor_id,
                    "scene_id": scene_id,
                    "conversation_id": conversation_id,
                    "continuity_id": continuity_id,
                    "recall_scope": recall_scope,
                    "disclosure_scope": disclosure_scope,
                    "attributes": attributes,
                    "evidence": evidence,
                    "consolidation_id": consolidation_id,
                    "valid_from": valid_from,
                }
            ]
        )
        return result[0]

    async def create_revisions(self, drafts: list[dict[str, Any]]) -> list[str]:
        conn = self._db.connection
        await conn.execute("BEGIN IMMEDIATE")
        try:
            result = [await self._create_revision(conn, draft) for draft in drafts]
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise
        return result

    @staticmethod
    async def _create_revision(conn: Any, draft: dict[str, Any]) -> str:
        memory_id = draft.get("memory_id") or uuid.uuid4().hex
        consolidation_id = draft["consolidation_id"]
        cursor = await conn.execute(
            "SELECT revision_id FROM memory_revisions WHERE memory_id=? AND consolidation_id=?",
            (memory_id, consolidation_id),
        )
        if await cursor.fetchone() is not None:
            return memory_id

        revision_id = uuid.uuid4().hex
        timestamp = _now_iso()
        valid_from = draft.get("valid_from") or timestamp
        cursor = await conn.execute(
            "SELECT current_revision_id FROM memory_items WHERE memory_id=?",
            (memory_id,),
        )
        row = await cursor.fetchone()
        previous = row[0] if row else None
        if row is None:
            await conn.execute(
                "INSERT INTO memory_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    memory_id,
                    draft["kind"],
                    draft["status"],
                    draft.get("actor_id"),
                    draft.get("scene_id"),
                    draft.get("conversation_id"),
                    draft.get("continuity_id"),
                    draft["recall_scope"],
                    draft["disclosure_scope"],
                    draft["confidence"],
                    draft["salience"],
                    revision_id,
                    timestamp,
                    timestamp,
                ),
            )
        else:
            await conn.execute(
                "UPDATE memory_revisions SET valid_to=? WHERE revision_id=? AND valid_to IS NULL",
                (valid_from, previous),
            )
            await conn.execute(
                """
                UPDATE memory_items SET kind=?,status=?,actor_id=?,scene_id=?,conversation_id=?,
                  continuity_id=?,recall_scope=?,disclosure_scope=?,confidence=?,salience=?,
                  current_revision_id=?,updated_at=? WHERE memory_id=?
                """,
                (
                    draft["kind"],
                    draft["status"],
                    draft.get("actor_id"),
                    draft.get("scene_id"),
                    draft.get("conversation_id"),
                    draft.get("continuity_id"),
                    draft["recall_scope"],
                    draft["disclosure_scope"],
                    draft["confidence"],
                    draft["salience"],
                    revision_id,
                    timestamp,
                    memory_id,
                ),
            )
        await conn.execute(
            "INSERT INTO memory_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (
                revision_id,
                memory_id,
                draft["content"],
                draft["summary"],
                json.dumps(draft["attributes"], ensure_ascii=False),
                valid_from,
                None,
                timestamp,
                previous,
                consolidation_id,
                timestamp,
            ),
        )
        await conn.executemany(
            "INSERT INTO memory_evidence VALUES(?,?,?,?)",
            [
                (
                    revision_id,
                    item["moment_id"],
                    item.get("role", "support"),
                    json.dumps(item.get("source", {}), ensure_ascii=False),
                )
                for item in draft["evidence"]
            ],
        )
        return memory_id

    async def all_current(self) -> list[dict[str, Any]]:
        cursor = await self._db.connection.execute(
            """
            SELECT i.memory_id,i.kind,i.status,i.actor_id,i.scene_id,i.conversation_id,
                   i.continuity_id,i.recall_scope,i.disclosure_scope,i.confidence,i.salience,
                   i.created_at,i.updated_at,r.revision_id,r.content,r.summary,r.attributes_json,
                   r.valid_from,r.valid_to
            FROM memory_items i JOIN memory_revisions r ON r.revision_id=i.current_revision_id
            ORDER BY i.updated_at
            """
        )
        return [self._row(row) for row in await cursor.fetchall()]

    async def count(self) -> int:
        cursor = await self._db.connection.execute(
            "SELECT COUNT(*) FROM memory_items WHERE status IN ('active','disputed')"
        )
        row = await cursor.fetchone()
        return int(row[0]) if row else 0

    async def evidence_for(
        self, revision_id: str, *, limit: int = 3
    ) -> list[dict[str, Any]]:
        cursor = await self._db.connection.execute(
            "SELECT moment_id,evidence_role,source_json FROM memory_evidence WHERE revision_id=? LIMIT ?",
            (revision_id, limit),
        )
        return [
            {"moment_id": row[0], "role": row[1], "source": json.loads(row[2])}
            for row in await cursor.fetchall()
        ]

    @staticmethod
    def _row(row: Any) -> dict[str, Any]:
        return {
            "memory_id": row[0],
            "kind": row[1],
            "status": row[2],
            "actor_id": row[3],
            "scene_id": row[4],
            "conversation_id": row[5],
            "continuity_id": row[6],
            "recall_scope": row[7],
            "disclosure_scope": row[8],
            "confidence": row[9],
            "salience": row[10],
            "created_at": row[11],
            "updated_at": row[12],
            "revision_id": row[13],
            "content": row[14],
            "summary": row[15],
            "attributes": json.loads(row[16]),
            "valid_from": row[17],
            "valid_to": row[18],
        }


class VectorRepository:
    """Memory/Knowledge embedding 向量仓库。"""

    def __init__(self, database: SqliteMemoryStore) -> None:
        self._db = database

    async def upsert_vector(
        self,
        *,
        owner_kind: str,
        owner_id: str,
        model: str,
        vector: np.ndarray,
    ) -> None:
        vec = np.asarray(vector, dtype=_VECTOR_DTYPE).reshape(-1)
        await self._db.connection.execute(
            """
            INSERT INTO embedding (owner_kind, owner_id, model, dim, vector)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(owner_kind, owner_id) DO UPDATE SET
                model=excluded.model, dim=excluded.dim, vector=excluded.vector,
                updated_at=CURRENT_TIMESTAMP
            """,
            (owner_kind, owner_id, model, int(vec.shape[0]), vec.tobytes()),
        )
        await self._db.connection.commit()

    async def get_vectors(self, owner_kind: str, model: str) -> dict[str, np.ndarray]:
        cursor = await self._db.connection.execute(
            "SELECT owner_id, vector FROM embedding WHERE owner_kind = ? AND model = ?",
            (owner_kind, model),
        )
        return {
            row[0]: np.frombuffer(row[1], dtype=_VECTOR_DTYPE)
            for row in await cursor.fetchall()
        }

    async def delete_vector(self, owner_kind: str, owner_id: str) -> None:
        await self._db.connection.execute(
            "DELETE FROM embedding WHERE owner_kind = ? AND owner_id = ?",
            (owner_kind, owner_id),
        )
        await self._db.connection.commit()

    async def count(self, owner_kind: str) -> int:
        cursor = await self._db.connection.execute(
            "SELECT COUNT(1) FROM embedding WHERE owner_kind = ?", (owner_kind,)
        )
        row = await cursor.fetchone()
        return int(row[0]) if row else 0


class RelationshipRepository:
    """可审计关系计数与证据化关系理解仓库。"""

    def __init__(self, database: SqliteMemoryStore) -> None:
        self._db = database

    async def observe(
        self,
        actor_id: str,
        *,
        kind: str,
        evidence_moment_id: str,
        display_name: str | None = None,
    ) -> RelationshipRecord:
        if kind not in {"direct", "ambient", "reply"}:
            raise ValueError(f"未知关系观察类型: {kind}")
        if not evidence_moment_id:
            raise ValueError("关系观察必须携带 Moment 证据")
        now = _now_iso()
        direct = int(kind == "direct")
        ambient = int(kind == "ambient")
        replies = int(kind == "reply")
        conn = self._db.connection
        await conn.execute("BEGIN IMMEDIATE")
        try:
            cursor = await conn.execute(
                "SELECT 1 FROM relationship_observations WHERE moment_id=?",
                (evidence_moment_id,),
            )
            if await cursor.fetchone() is None:
                await conn.execute(
                    """
                    INSERT INTO relationship_actors VALUES(?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(actor_id) DO UPDATE SET
                      display_name=CASE WHEN excluded.display_name='' THEN relationship_actors.display_name ELSE excluded.display_name END,
                      last_seen_at=excluded.last_seen_at,
                      direct_interactions=relationship_actors.direct_interactions+excluded.direct_interactions,
                      ambient_observations=relationship_actors.ambient_observations+excluded.ambient_observations,
                      replies=relationship_actors.replies+excluded.replies,
                      updated_at=excluded.updated_at
                    """,
                    (
                        actor_id,
                        display_name or "",
                        now,
                        now,
                        direct,
                        ambient,
                        replies,
                        None,
                        now,
                    ),
                )
                await conn.execute(
                    "INSERT INTO relationship_observations VALUES(?,?,?,?)",
                    (evidence_moment_id, actor_id, kind, now),
                )
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise
        record = await self.get(actor_id)
        assert record is not None
        return record

    async def revise(
        self,
        actor_id: str,
        *,
        summary: str,
        attributes: dict[str, Any],
        confidence: float,
        evidence_moment_ids: list[str],
        consolidation_id: str,
    ) -> str:
        if not evidence_moment_ids:
            raise ValueError("关系修订必须携带 Moment 证据")
        conn = self._db.connection
        revision_id = uuid.uuid4().hex
        now = _now_iso()
        cursor = await conn.execute(
            "SELECT current_revision_id FROM relationship_actors WHERE actor_id=?",
            (actor_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            raise ValueError(f"关系 actor 尚未观察: {actor_id}")
        await conn.execute("BEGIN IMMEDIATE")
        try:
            if row[0]:
                await conn.execute(
                    "UPDATE relationship_revisions SET valid_to=? WHERE revision_id=?",
                    (now, row[0]),
                )
            await conn.execute(
                "INSERT INTO relationship_revisions VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    revision_id,
                    actor_id,
                    summary,
                    json.dumps(attributes, ensure_ascii=False),
                    confidence,
                    now,
                    None,
                    consolidation_id,
                    now,
                ),
            )
            await conn.executemany(
                "INSERT INTO relationship_evidence VALUES(?,?)",
                [(revision_id, item) for item in evidence_moment_ids],
            )
            await conn.execute(
                "UPDATE relationship_actors SET current_revision_id=?,updated_at=? WHERE actor_id=?",
                (revision_id, now, actor_id),
            )
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise
        return revision_id

    async def get(self, actor_id: str) -> RelationshipRecord | None:
        cursor = await self._db.connection.execute(
            """
            SELECT a.actor_id,a.display_name,a.first_seen_at,a.last_seen_at,
                   a.direct_interactions,a.ambient_observations,a.replies,
                   COALESCE(r.summary,''),COALESCE(r.attributes_json,'{}'),COALESCE(r.confidence,0)
            FROM relationship_actors a
            LEFT JOIN relationship_revisions r ON r.revision_id=a.current_revision_id
            WHERE a.actor_id=?
            """,
            (actor_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return RelationshipRecord(
            row[0],
            row[1],
            row[2],
            row[3],
            int(row[4]),
            int(row[5]),
            int(row[6]),
            row[7],
            json.loads(row[8]),
            float(row[9]),
        )

    async def all_recent(self, *, limit: int = 50) -> list[RelationshipRecord]:
        cursor = await self._db.connection.execute(
            "SELECT actor_id FROM relationship_actors ORDER BY last_seen_at DESC LIMIT ?",
            (limit,),
        )
        result = []
        for row in await cursor.fetchall():
            record = await self.get(row[0])
            if record:
                result.append(record)
        return result


class ConsolidationJobRepository:
    """长期记忆巩固任务的持久队列。"""

    def __init__(self, database: SqliteMemoryStore) -> None:
        self._db = database

    async def recover_expired(self) -> None:
        await self._db.connection.execute(
            """
            UPDATE consolidation_jobs SET state='pending',lease_until=NULL
            WHERE state='claimed' AND lease_until<?
            """,
            (_now_iso(),),
        )
        await self._db.connection.commit()

    async def enqueue(
        self, episode: Episode, *, debounce_seconds: int, max_wait_seconds: int
    ) -> None:
        now = datetime.now(timezone.utc)
        debounce_at = now + timedelta(seconds=debounce_seconds)
        deadline = _parse_iso(episode.started_at) + timedelta(seconds=max_wait_seconds)
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
                job_id,
                episode.episode_id,
                episode.version,
                episode.scene_id,
                episode.actor_id,
                episode.salience,
                available_at,
                "memory-policy-v2",
                timestamp,
            ),
        )
        await self._db.connection.commit()

    async def claim_due(
        self, *, limit: int, lease_seconds: int
    ) -> list[ConsolidationJob]:
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
        timestamp = _now_iso()
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
        self,
        jobs: list[ConsolidationJob],
        *,
        error_code: str,
        retry_base_seconds: int,
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


class RelationshipProjection:
    """从 Conversation Log 幂等派生关系互动计数。"""

    def __init__(
        self,
        *,
        recorder: ConversationLogReaderPort,
        repository: RelationshipRepository,
        database: SqliteMemoryStore,
    ) -> None:
        self._recorder = recorder
        self._repository = repository
        self._database = database

    async def project_pending(self) -> int:
        await self._recorder.flush()
        cursor = await self._database.connection.execute(
            "SELECT position FROM projection_checkpoints WHERE projection_name='relationship'"
        )
        row = await cursor.fetchone()
        checkpoint = int(row[0]) if row else 0
        moments = self._recorder.moments_after(checkpoint)
        for moment in moments:
            actor_id = moment.actor_id
            if actor_id and moment.kind == MomentKind.PERCEPTION.value:
                address_mode = str(moment.content.get("address_mode") or "ambient")
                await self._repository.observe(
                    actor_id,
                    kind="direct" if address_mode == "direct" else "ambient",
                    evidence_moment_id=moment.moment_id,
                    display_name=moment.actor_name,
                )
            elif actor_id and moment.kind == MomentKind.REPLY.value:
                await self._repository.observe(
                    actor_id,
                    kind="reply",
                    evidence_moment_id=moment.moment_id,
                    display_name=moment.actor_name,
                )
        if moments:
            await self._database.connection.execute(
                """
                INSERT INTO projection_checkpoints VALUES('relationship',?,?)
                ON CONFLICT(projection_name) DO UPDATE SET
                  position=excluded.position,updated_at=excluded.updated_at
                """,
                (moments[-1].seq, _now_iso()),
            )
            await self._database.connection.commit()
        return len(moments)


class EpisodeProjection:
    """从 Conversation Log 派生、可重建的持久 Episode 投影。"""

    def __init__(
        self,
        db_path: Path,
        recorder: ConversationLogReaderPort,
        *,
        idle_seconds: int = 300,
        integrity_check: bool = True,
    ) -> None:
        self._path = db_path
        self._recorder = recorder
        self._idle_seconds = max(10, idle_seconds)
        self._integrity_check = integrity_check

    async def start(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self._path)) as conn:
            conn.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS projection_meta(
                  key TEXT PRIMARY KEY,value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS episodes(
                  episode_id TEXT PRIMARY KEY, version INTEGER NOT NULL,
                  interaction_id TEXT NOT NULL, scene_id TEXT NOT NULL,
                  conversation_id TEXT NOT NULL, recall_scope TEXT NOT NULL,
                  disclosure_scope TEXT NOT NULL, actor_id TEXT,
                  first_position INTEGER NOT NULL, last_position INTEGER NOT NULL,
                  started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
                  boundary_reason TEXT NOT NULL, salience REAL NOT NULL,
                  status TEXT NOT NULL, consolidated_at TEXT
                );
                DROP INDEX IF EXISTS idx_episode_interaction;
                CREATE INDEX IF NOT EXISTS idx_episode_open_interaction
                  ON episodes(
                    interaction_id,scene_id,conversation_id,
                    recall_scope,disclosure_scope,status
                  );
                CREATE TABLE IF NOT EXISTS episode_moments(
                  episode_id TEXT NOT NULL, moment_id TEXT NOT NULL UNIQUE,
                  position INTEGER NOT NULL, PRIMARY KEY(episode_id,moment_id)
                );
                CREATE INDEX IF NOT EXISTS idx_episode_status
                  ON episodes(status,last_position);
                """
            )
            columns = {
                str(row[1])
                for row in conn.execute("PRAGMA table_info(episodes)").fetchall()
            }
            required = {"conversation_id", "recall_scope", "disclosure_scope"}
            if not required.issubset(columns):
                raise RuntimeError("检测到旧 Episode 投影；开发阶段请删除后重建")
            if self._integrity_check:
                result = conn.execute("PRAGMA integrity_check").fetchone()
                if result is None or result[0] != "ok":
                    raise RuntimeError(f"Episode 投影完整性检查失败: {result}")
            conn.commit()

    async def project_pending(self, *, seal: bool = False) -> int:
        await self._recorder.flush()
        with closing(sqlite3.connect(self._path)) as conn:
            row = conn.execute(
                "SELECT value FROM projection_meta WHERE key='position'"
            ).fetchone()
            checkpoint = int(row[0]) if row else 0
        moments = self._recorder.moments_after(checkpoint)
        if not moments:
            if seal:
                self._seal_open("forced")
            else:
                self._seal_idle()
            return 0
        with closing(sqlite3.connect(self._path)) as conn:
            conn.execute("BEGIN IMMEDIATE")
            for moment in moments:
                self._project_moment(conn, moment)
            conn.execute(
                """
                INSERT INTO projection_meta VALUES('position',?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value
                """,
                (str(moments[-1].seq),),
            )
            if seal:
                conn.execute(
                    """
                    UPDATE episodes SET status='sealed',boundary_reason='forced'
                    WHERE status='open'
                    """
                )
            else:
                self._seal_idle(conn)
            conn.commit()
        return len(moments)

    def pending_consolidation(self, *, limit: int = 8) -> list[Episode]:
        with closing(sqlite3.connect(self._path)) as conn:
            rows = conn.execute(
                """
                SELECT * FROM episodes
                WHERE status='sealed' AND consolidated_at IS NULL
                ORDER BY last_position LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [self._hydrate(conn, row) for row in rows]

    def get_episode(self, episode_id: str) -> Episode | None:
        with closing(sqlite3.connect(self._path)) as conn:
            row = conn.execute(
                "SELECT * FROM episodes WHERE episode_id=?", (episode_id,)
            ).fetchone()
            return self._hydrate(conn, row) if row is not None else None

    def recover_interrupted(self) -> None:
        self._seal_open("process_interrupted")

    def list_episodes(
        self, *, since_iso: str | None = None, limit: int = 100
    ) -> list[Episode]:
        with closing(sqlite3.connect(self._path)) as conn:
            if since_iso:
                rows = conn.execute(
                    """
                    SELECT * FROM episodes WHERE ended_at>=?
                    ORDER BY first_position DESC LIMIT ?
                    """,
                    (since_iso, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM episodes ORDER BY first_position DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            result = [self._hydrate(conn, row) for row in rows]
        return list(reversed(result))

    def mark_consolidated(self, episode_id: str, consolidated_at: str) -> None:
        with closing(sqlite3.connect(self._path)) as conn:
            conn.execute(
                "UPDATE episodes SET consolidated_at=? WHERE episode_id=?",
                (consolidated_at, episode_id),
            )
            conn.commit()

    def rebuild(self) -> None:
        with closing(sqlite3.connect(self._path)) as conn:
            conn.execute("DELETE FROM episode_moments")
            conn.execute("DELETE FROM episodes")
            conn.execute("DELETE FROM projection_meta")
            conn.commit()

    def _project_moment(self, conn: sqlite3.Connection, moment: Moment) -> None:
        interaction_id = moment.interaction_id or moment.trace_id or moment.moment_id
        scene_id = moment.scene_id or ""
        row = conn.execute(
            """
            SELECT episode_id,version,first_position,salience FROM episodes
            WHERE interaction_id=? AND scene_id=? AND conversation_id=?
              AND recall_scope=? AND disclosure_scope=? AND status='open'
            ORDER BY last_position DESC LIMIT 1
            """,
            (
                interaction_id,
                scene_id,
                moment.conversation_id,
                moment.recall_scope,
                moment.disclosure_scope,
            ),
        ).fetchone()
        if row is None:
            episode_id = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO episodes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',NULL)",
                (
                    episode_id,
                    1,
                    interaction_id,
                    scene_id,
                    moment.conversation_id,
                    moment.recall_scope,
                    moment.disclosure_scope,
                    moment.actor_id,
                    moment.seq,
                    moment.seq,
                    moment.occurred_at,
                    moment.occurred_at,
                    "interaction",
                    moment.importance,
                ),
            )
        else:
            episode_id = row[0]
            count_row = conn.execute(
                "SELECT COUNT(*) FROM episode_moments WHERE episode_id=?",
                (episode_id,),
            ).fetchone()
            count = int(count_row[0]) if count_row else 0
            salience = (float(row[3]) * count + moment.importance) / (count + 1)
            conn.execute(
                """
                UPDATE episodes
                SET version=version+1,last_position=?,ended_at=?,salience=?
                WHERE episode_id=?
                """,
                (moment.seq, moment.occurred_at, salience, episode_id),
            )
        conn.execute(
            "INSERT INTO episode_moments VALUES(?,?,?)",
            (episode_id, moment.moment_id, moment.seq),
        )
        if moment.kind in {MomentKind.REPLY.value, MomentKind.SILENCE.value}:
            conn.execute(
                """
                UPDATE episodes
                SET status='sealed',boundary_reason='interaction_completed'
                WHERE episode_id=?
                """,
                (episode_id,),
            )

    def _seal_open(self, reason: str) -> None:
        with closing(sqlite3.connect(self._path)) as conn:
            conn.execute(
                "UPDATE episodes SET status='sealed',boundary_reason=? WHERE status='open'",
                (reason,),
            )
            conn.commit()

    def _seal_idle(self, conn: sqlite3.Connection | None = None) -> None:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=self._idle_seconds)
        cutoff_iso = cutoff.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        if conn is not None:
            conn.execute(
                """
                UPDATE episodes SET status='sealed',boundary_reason='idle_timeout'
                WHERE status='open' AND ended_at<=?
                """,
                (cutoff_iso,),
            )
            return
        with closing(sqlite3.connect(self._path)) as connection:
            self._seal_idle(connection)
            connection.commit()

    def _hydrate(self, conn: sqlite3.Connection, row: tuple[Any, ...]) -> Episode:
        positions = [
            item[0]
            for item in conn.execute(
                """
                SELECT position FROM episode_moments
                WHERE episode_id=? ORDER BY position
                """,
                (row[0],),
            )
        ]
        by_position = {
            item.seq: item
            for item in self._recorder.log.query(
                after_position=max(0, row[8] - 1),
                limit=row[9] - row[8] + 1,
            )
        }
        moments = tuple(
            by_position[position]
            for position in positions
            if position in by_position
        )
        return Episode(
            row[0],
            row[1],
            row[2],
            row[3],
            row[4],
            row[5],
            row[6],
            row[7],
            row[8],
            row[9],
            row[10],
            row[11],
            row[12],
            row[13],
            moments,
        )
