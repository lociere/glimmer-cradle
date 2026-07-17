"""从 Experience Ledger 派生、可重建的持久 Episode 投影。"""
from __future__ import annotations

import sqlite3
import uuid
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from glimmer_cradle.cognition.experience.events import Moment, MomentKind
from glimmer_cradle.cognition.experience.recorder import ExperienceRecorder


@dataclass(frozen=True)
class Episode:
    episode_id: str
    version: int
    interaction_id: str
    scene_id: str
    conversation_id: str
    recall_scope: str
    disclosure_scope: str
    actor_id: str | None
    first_position: int
    last_position: int
    started_at: str
    ended_at: str
    boundary_reason: str
    salience: float
    moments: tuple[Moment, ...]


class EpisodeProjection:
    """按 interaction/scene/causation 形成 Episode；投影可删除后从账本重建。"""

    def __init__(
        self,
        db_path: Path,
        recorder: ExperienceRecorder,
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
            conn.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS projection_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
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
                interaction_id,scene_id,conversation_id,recall_scope,disclosure_scope,status
              );
            CREATE TABLE IF NOT EXISTS episode_moments(
              episode_id TEXT NOT NULL, moment_id TEXT NOT NULL UNIQUE,
              position INTEGER NOT NULL, PRIMARY KEY(episode_id,moment_id)
            );
            CREATE INDEX IF NOT EXISTS idx_episode_status ON episodes(status,last_position);
            """)
            columns = {
                str(row[1]) for row in conn.execute("PRAGMA table_info(episodes)").fetchall()
            }
            required = {
                "conversation_id", "recall_scope", "disclosure_scope",
            }
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
            row = conn.execute("SELECT value FROM projection_meta WHERE key='position'").fetchone()
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
                "INSERT INTO projection_meta VALUES('position',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (str(moments[-1].seq),))
            if seal:
                conn.execute(
                    "UPDATE episodes SET status='sealed',boundary_reason='forced' WHERE status='open'"
                )
            else:
                self._seal_idle(conn)
            conn.commit()
        return len(moments)

    def pending_consolidation(self, *, limit: int = 8) -> list[Episode]:
        with closing(sqlite3.connect(self._path)) as conn:
            rows = conn.execute(
                "SELECT * FROM episodes WHERE status='sealed' AND consolidated_at IS NULL ORDER BY last_position LIMIT ?",
                (limit,)).fetchall()
            return [self._hydrate(conn, row) for row in rows]

    def get_episode(self, episode_id: str) -> Episode | None:
        with closing(sqlite3.connect(self._path)) as conn:
            row = conn.execute(
                "SELECT * FROM episodes WHERE episode_id=?", (episode_id,)
            ).fetchone()
            return self._hydrate(conn, row) if row is not None else None

    def recover_interrupted(self) -> None:
        """补投影完成后，收口仍没有语义终结事件的上次进程批次。"""
        self._seal_open("process_interrupted")

    def list_episodes(self, *, since_iso: str | None = None, limit: int = 100) -> list[Episode]:
        with closing(sqlite3.connect(self._path)) as conn:
            if since_iso:
                rows = conn.execute(
                    "SELECT * FROM episodes WHERE ended_at>=? ORDER BY first_position DESC LIMIT ?",
                    (since_iso, limit)).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM episodes ORDER BY first_position DESC LIMIT ?", (limit,)).fetchall()
            result = [self._hydrate(conn, row) for row in rows]
        return list(reversed(result))

    def mark_consolidated(self, episode_id: str, consolidated_at: str) -> None:
        with closing(sqlite3.connect(self._path)) as conn:
            conn.execute("UPDATE episodes SET consolidated_at=? WHERE episode_id=?",
                         (consolidated_at, episode_id))
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
            """SELECT episode_id,version,first_position,salience FROM episodes
               WHERE interaction_id=? AND scene_id=? AND conversation_id=?
                 AND recall_scope=? AND disclosure_scope=? AND status='open'
               ORDER BY last_position DESC LIMIT 1""",
            (
                interaction_id, scene_id, moment.conversation_id,
                moment.recall_scope, moment.disclosure_scope,
            )).fetchone()
        if row is None:
            episode_id = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO episodes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',NULL)",
                (
                    episode_id, 1, interaction_id, scene_id, moment.conversation_id,
                    moment.recall_scope, moment.disclosure_scope, moment.actor_id,
                    moment.seq, moment.seq, moment.occurred_at, moment.occurred_at,
                    "interaction", moment.importance,
                ),
            )
        else:
            episode_id = row[0]
            count = conn.execute("SELECT COUNT(*) FROM episode_moments WHERE episode_id=?",
                                 (episode_id,)).fetchone()[0]
            salience = (float(row[3]) * count + moment.importance) / (count + 1)
            conn.execute("UPDATE episodes SET version=version+1,last_position=?,ended_at=?,salience=? WHERE episode_id=?",
                         (moment.seq, moment.occurred_at, salience, episode_id))
        conn.execute("INSERT INTO episode_moments VALUES(?,?,?)",
                     (episode_id, moment.moment_id, moment.seq))
        if moment.kind in {MomentKind.REPLY.value, MomentKind.SILENCE.value}:
            conn.execute(
                """UPDATE episodes
                   SET status='sealed',boundary_reason='interaction_completed'
                   WHERE episode_id=?""",
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
                """UPDATE episodes SET status='sealed',boundary_reason='idle_timeout'
                   WHERE status='open' AND ended_at<=?""",
                (cutoff_iso,),
            )
            return
        with closing(sqlite3.connect(self._path)) as connection:
            self._seal_idle(connection)
            connection.commit()

    def _hydrate(self, conn: sqlite3.Connection, row: tuple) -> Episode:
        positions = [item[0] for item in conn.execute(
            "SELECT position FROM episode_moments WHERE episode_id=? ORDER BY position", (row[0],))]
        by_position = {item.seq: item for item in self._recorder.ledger.query(
            after_position=max(0, row[8] - 1), limit=row[9] - row[8] + 1)}
        moments = tuple(by_position[position] for position in positions if position in by_position)
        return Episode(
            row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7],
            row[8], row[9], row[10], row[11], row[12], row[13], moments,
        )
