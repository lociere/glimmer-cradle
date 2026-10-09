-- 仅在保留原 v4 库的离线复制候选上执行；事务由迁移 Adapter 拥有。
ALTER TABLE jobs RENAME TO jobs_v4;
DROP INDEX jobs_due;
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
  enqueue_sequence INTEGER NOT NULL CHECK(enqueue_sequence>0 AND enqueue_sequence<=9007199254740991),
  UNIQUE(scope_id,idempotency_key),
  CHECK((status='running' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL)
    OR (status<>'running' AND lease_owner IS NULL AND lease_until IS NULL))
);
CREATE INDEX jobs_due ON jobs(status,due_at,created_at);
INSERT INTO jobs(job_id,scope_id,goal_id,kind,idempotency_key,payload_json,request_digest,due_at,retry_mode,
  max_attempts,status,revision,attempt,authority_epoch,fencing_token,lease_owner,lease_until,error_code,
  result_json,created_at,updated_at,enqueue_sequence)
SELECT job_id,scope_id,goal_id,kind,idempotency_key,payload_json,request_digest,due_at,retry_mode,
  max_attempts,status,revision,attempt,authority_epoch,fencing_token,lease_owner,lease_until,error_code,
  result_json,created_at,updated_at,ROW_NUMBER() OVER(ORDER BY created_at,job_id) FROM jobs_v4;
DROP TABLE jobs_v4;
CREATE UNIQUE INDEX jobs_enqueue_sequence ON jobs(enqueue_sequence);
CREATE TABLE job_enqueue_sequence(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  last_sequence INTEGER NOT NULL CHECK(last_sequence>=0 AND last_sequence<=9007199254740991));
INSERT INTO job_enqueue_sequence SELECT 1,COUNT(*) FROM jobs;
PRAGMA user_version=5;
