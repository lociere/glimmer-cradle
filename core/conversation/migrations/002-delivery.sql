CREATE TABLE IF NOT EXISTS delivery_destinations(
  destination_id TEXT PRIMARY KEY,
  authority_epoch TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_outputs(
  output_id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  authority_epoch TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation > 0),
  content_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'generated','queued','sent','delivered','playing','completed','interrupted','failed','unknown'
  )),
  heard_through_ms INTEGER NOT NULL DEFAULT 0 CHECK(heard_through_ms >= 0),
  duration_ms INTEGER,
  terminal_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(destination_id, authority_epoch, generation)
);

CREATE INDEX IF NOT EXISTS idx_delivery_outputs_recovery
  ON delivery_outputs(authority_epoch, status, updated_at);

CREATE TABLE IF NOT EXISTS delivery_receipts(
  receipt_id TEXT PRIMARY KEY,
  output_id TEXT NOT NULL REFERENCES delivery_outputs(output_id),
  received_at TEXT NOT NULL
);
