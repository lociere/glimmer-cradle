PRAGMA application_id = 1195591000;
PRAGMA user_version = 1;
CREATE TABLE executions (
  invocation_id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  target_json TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('prepared','authorized','dispatched','succeeded','failed','unknown')),
  revision INTEGER NOT NULL CHECK(revision > 0),
  attempt INTEGER NOT NULL CHECK(attempt IN (0,1)),
  owner_id TEXT,
  authorization_json TEXT,
  result_json TEXT,
  error_code TEXT,
  side_effects TEXT NOT NULL CHECK(side_effects IN ('not_dispatched','confirmed','none','unknown')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(scope_id,idempotency_key)
);
CREATE TABLE execution_outbox (
  event_id TEXT PRIMARY KEY,
  invocation_id TEXT NOT NULL REFERENCES executions(invocation_id),
  revision INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  UNIQUE(invocation_id,revision)
);
CREATE INDEX execution_outbox_pending ON execution_outbox(acknowledged_at,created_at,invocation_id,revision);
