CREATE TABLE authority_aggregates(
  aggregate_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
  epoch INTEGER NOT NULL CHECK(epoch>0), fencing_token INTEGER NOT NULL CHECK(fencing_token>0),
  expires_at INTEGER NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
  status TEXT NOT NULL CHECK(status IN ('active','revoking','released')), updated_at INTEGER NOT NULL
);
CREATE TABLE authority_handovers(
  transfer_id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL REFERENCES authority_aggregates(aggregate_id),
  handover_json TEXT NOT NULL, prepared_at INTEGER NOT NULL, completed_at INTEGER,
  receipt_json TEXT, target_lease_json TEXT,
  CHECK((completed_at IS NULL AND receipt_json IS NULL AND target_lease_json IS NULL)
    OR (completed_at IS NOT NULL AND receipt_json IS NOT NULL AND target_lease_json IS NOT NULL))
);
PRAGMA user_version=1;
PRAGMA application_id=0x47434155;
