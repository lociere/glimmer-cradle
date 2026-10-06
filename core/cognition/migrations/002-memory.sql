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
-- 业务结果和修订同事务提交；它不是 Jobs 调度状态，不能用 receipt 缺失证明未执行。
CREATE TABLE memory_consolidation_receipts(
  receipt_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, scope_id TEXT NOT NULL,
  request_digest TEXT NOT NULL, draft_digest TEXT NOT NULL,
  memory_ids_json TEXT NOT NULL, committed_at TEXT NOT NULL
);
CREATE TABLE memory_consolidation_inputs(
  episode_id TEXT NOT NULL, episode_version INTEGER NOT NULL CHECK(episode_version>0),
  scope_id TEXT NOT NULL, input_digest TEXT NOT NULL,
  receipt_id TEXT NOT NULL REFERENCES memory_consolidation_receipts(receipt_id),
  PRIMARY KEY(episode_id,episode_version)
);
-- 仅保存接收端提交资格，不承担 Jobs 调度、退避或终态 owner。
CREATE TABLE memory_job_authority(epoch INTEGER NOT NULL);
INSERT INTO memory_job_authority VALUES(0);
-- 临时装配切换屏障；不是 authority/lease。旧队列删除时随受控数据迁移退出。
CREATE TABLE memory_consolidation_dispatch(
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  owner TEXT NOT NULL CHECK(owner IN ('legacy','external'))
);
CREATE TABLE memory_job_attempts(
  job_id TEXT NOT NULL, attempt INTEGER NOT NULL,
  scope_id TEXT NOT NULL, authority_epoch INTEGER NOT NULL,
  fencing_token INTEGER NOT NULL, owner_id TEXT NOT NULL, lease_until INTEGER NOT NULL,
  operation_id TEXT, request_digest TEXT,
  state TEXT NOT NULL CHECK(state IN ('active','sealed','applied')),
  receipt_id TEXT REFERENCES memory_consolidation_receipts(receipt_id),
  observed_at INTEGER,
  PRIMARY KEY(job_id,attempt)
);
