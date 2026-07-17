"""Cognition 版本化记忆、关系、意向、知识与索引的单写者数据库。"""
from __future__ import annotations

from pathlib import Path
import aiosqlite

from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.foundation.path_utils import resolve_cognition_db_path

logger = get_logger("cognition_database")
SCHEMA_VERSION = 3

_DDL = """
CREATE TABLE schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE memory_items(
  memory_id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
  actor_id TEXT, scene_id TEXT, conversation_id TEXT, continuity_id TEXT,
  recall_scope TEXT NOT NULL, disclosure_scope TEXT NOT NULL,
  confidence REAL NOT NULL, salience REAL NOT NULL,
  current_revision_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE memory_revisions(
  revision_id TEXT PRIMARY KEY, memory_id TEXT NOT NULL REFERENCES memory_items(memory_id),
  content TEXT NOT NULL, summary TEXT NOT NULL, attributes_json TEXT NOT NULL,
  valid_from TEXT NOT NULL, valid_to TEXT, observed_at TEXT NOT NULL,
  supersedes_revision_id TEXT, consolidation_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_memory_consolidation_dedup
  ON memory_revisions(memory_id, consolidation_id, content);
CREATE TABLE memory_evidence(
  revision_id TEXT NOT NULL REFERENCES memory_revisions(revision_id),
  moment_id TEXT NOT NULL, evidence_role TEXT NOT NULL, source_json TEXT NOT NULL,
  PRIMARY KEY(revision_id,moment_id)
);
CREATE TABLE memory_relations(
  relation_id TEXT PRIMARY KEY, from_memory_id TEXT NOT NULL, to_memory_id TEXT NOT NULL,
  relation_kind TEXT NOT NULL, confidence REAL NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(from_memory_id,to_memory_id,relation_kind)
);
CREATE TABLE relationship_actors(
  actor_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL, direct_interactions INTEGER NOT NULL,
  ambient_observations INTEGER NOT NULL, replies INTEGER NOT NULL,
  current_revision_id TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE relationship_observations(
  moment_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES relationship_actors(actor_id),
  interaction_kind TEXT NOT NULL, observed_at TEXT NOT NULL
);
CREATE TABLE relationship_revisions(
  revision_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES relationship_actors(actor_id),
  summary TEXT NOT NULL, attributes_json TEXT NOT NULL, confidence REAL NOT NULL,
  valid_from TEXT NOT NULL, valid_to TEXT, consolidation_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE relationship_evidence(
  revision_id TEXT NOT NULL REFERENCES relationship_revisions(revision_id),
  moment_id TEXT NOT NULL, PRIMARY KEY(revision_id,moment_id)
);
CREATE TABLE intentions(
  intention_id TEXT PRIMARY KEY, content TEXT NOT NULL, status TEXT NOT NULL,
  due_at TEXT, source_revision_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE intention_transitions(
  transition_id TEXT PRIMARY KEY, intention_id TEXT NOT NULL REFERENCES intentions(intention_id),
  from_status TEXT, to_status TEXT NOT NULL, reason TEXT NOT NULL,
  evidence_moment_id TEXT, occurred_at TEXT NOT NULL
);
CREATE TABLE knowledge_entry(
  entry_id TEXT PRIMARY KEY, content TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1, scope TEXT NOT NULL DEFAULT 'knowledge',
  source TEXT NOT NULL DEFAULT 'config', activation_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE embedding(
  owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, model TEXT NOT NULL,
  dim INTEGER NOT NULL, vector BLOB NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(owner_kind,owner_id)
);
CREATE TABLE consolidation_jobs(
  job_id TEXT PRIMARY KEY, episode_id TEXT NOT NULL UNIQUE,
  episode_version INTEGER NOT NULL, scene_id TEXT NOT NULL, actor_id TEXT,
  state TEXT NOT NULL, priority REAL NOT NULL, available_at TEXT NOT NULL,
  lease_until TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
  policy_version TEXT NOT NULL, error_code TEXT,
  created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
);
CREATE TABLE projection_checkpoints(
  projection_name TEXT PRIMARY KEY, position INTEGER NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_memory_active ON memory_items(status,kind,updated_at);
CREATE INDEX idx_memory_actor ON memory_items(actor_id,status);
CREATE INDEX idx_relationship_recent ON relationship_actors(last_seen_at);
CREATE INDEX idx_relationship_observation_actor ON relationship_observations(actor_id,observed_at);
CREATE INDEX idx_consolidation_jobs_due ON consolidation_jobs(state,available_at,priority);
"""

class CognitionDatabase:
    def __init__(self, db_path: Path | None = None) -> None:
        self._db_path = db_path or resolve_cognition_db_path()
        self._conn: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        if self._conn is not None:
            return
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(str(self._db_path))
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA foreign_keys=ON")
        cursor = await self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'")
        if await cursor.fetchone() is None:
            await self._conn.executescript(_DDL)
            await self._conn.execute("INSERT INTO schema_meta VALUES('schema_version',?)",
                                     (str(SCHEMA_VERSION),))
            await self._conn.commit()
        else:
            cursor = await self._conn.execute(
                "SELECT value FROM schema_meta WHERE key='schema_version'")
            row = await cursor.fetchone()
            version = int(row[0]) if row is not None else 0
            if version != SCHEMA_VERSION:
                raise RuntimeError("检测到非当前记忆架构数据库；开发阶段请删除旧数据后重启")
        logger.info("记忆事实库已就绪", db_path=str(self._db_path), schema_version=SCHEMA_VERSION)

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    @property
    def connection(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("CognitionDatabase 尚未连接")
        return self._conn
