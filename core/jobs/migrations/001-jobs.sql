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
-- 删除大 payload 后仍保留触发身份，避免 retention 后重新执行已完成副作用。
CREATE TABLE job_tombstones(
  job_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL, terminal_status TEXT NOT NULL, revision INTEGER NOT NULL,
  UNIQUE(scope_id,idempotency_key)
);
PRAGMA user_version=1;
PRAGMA application_id=0x47434a42;
