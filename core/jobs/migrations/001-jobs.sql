CREATE TABLE job_authority(singleton INTEGER PRIMARY KEY CHECK(singleton=1), epoch INTEGER NOT NULL CHECK(epoch>0));
CREATE TABLE jobs(
  job_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, goal_id TEXT NOT NULL, kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, payload_json TEXT NOT NULL, request_digest TEXT NOT NULL,
  due_at INTEGER NOT NULL, retry_mode TEXT NOT NULL CHECK(retry_mode IN ('idempotent','reconcile')),
  max_attempts INTEGER NOT NULL CHECK(max_attempts>0),
  status TEXT NOT NULL CHECK(status IN ('queued','running','retry_wait','succeeded','cancelled','dead_letter','unknown')),
  revision INTEGER NOT NULL CHECK(revision>0), attempt INTEGER NOT NULL CHECK(attempt>=0),
  authority_epoch INTEGER NOT NULL, fencing_token INTEGER NOT NULL CHECK(fencing_token>=0),
  lease_owner TEXT, lease_until INTEGER, error_code TEXT, result_json TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(scope_id,idempotency_key),
  CHECK((status='running' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL)
    OR (status<>'running' AND lease_owner IS NULL AND lease_until IS NULL))
);
CREATE INDEX jobs_due ON jobs(status,due_at,created_at);
-- 源接纳与 Job 同事务；仅保留摘要/原政策，ACK 丢失及 retention 后不重新分配工作。
CREATE TABLE job_source_receipts(
  source_id TEXT NOT NULL, source_request_id TEXT NOT NULL, input_digest TEXT NOT NULL,
  job_id TEXT NOT NULL, request_identity_digest TEXT NOT NULL,
  initial_due_at INTEGER NOT NULL CHECK(initial_due_at>=0), max_attempts INTEGER NOT NULL CHECK(max_attempts>0),
  accepted_at INTEGER NOT NULL, PRIMARY KEY(source_id,source_request_id)
);
-- 删除大 payload 后仍保留触发身份，避免 retention 后重新执行已完成副作用。
CREATE TABLE job_tombstones(
  job_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL, terminal_status TEXT NOT NULL, revision INTEGER NOT NULL,
  UNIQUE(scope_id,idempotency_key)
);
CREATE TABLE job_triggers(
  trigger_id TEXT PRIMARY KEY, definition_json TEXT NOT NULL, definition_digest TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  next_due_at INTEGER, last_due_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX job_triggers_due ON job_triggers(enabled,next_due_at);
CREATE TABLE job_trigger_occurrences(
  trigger_id TEXT NOT NULL REFERENCES job_triggers(trigger_id), occurrence_id TEXT NOT NULL,
  occurrence_digest TEXT NOT NULL, job_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(trigger_id,occurrence_id)
);
-- 不关联 jobs FK：retention 后仍须保留最小 attempt 身份与对账审计。
CREATE TABLE job_attempts(
  job_id TEXT NOT NULL, attempt INTEGER NOT NULL CHECK(attempt>0),
  authority_epoch INTEGER NOT NULL, fencing_token INTEGER NOT NULL, owner_id TEXT NOT NULL,
  started_at INTEGER NOT NULL, lease_until INTEGER NOT NULL, finished_at INTEGER,
  status TEXT NOT NULL CHECK(status IN ('running','retry_wait','succeeded','cancelled','dead_letter','unknown')),
  error_code TEXT, PRIMARY KEY(job_id,attempt)
);
CREATE TABLE job_reconciliations(
  source_id TEXT NOT NULL, evidence_id TEXT NOT NULL, evidence_digest TEXT NOT NULL,
  job_id TEXT NOT NULL, attempt INTEGER NOT NULL, accepted_revision INTEGER NOT NULL, accepted_at INTEGER NOT NULL,
  PRIMARY KEY(source_id,evidence_id)
);
CREATE TABLE job_outbox(
  event_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, revision INTEGER NOT NULL,
  event_json TEXT NOT NULL, created_at INTEGER NOT NULL, acknowledged_at INTEGER,
  UNIQUE(job_id,revision)
);
CREATE INDEX job_outbox_pending ON job_outbox(acknowledged_at,created_at,job_id,revision);
PRAGMA user_version=4;
PRAGMA application_id=0x47434a42;
