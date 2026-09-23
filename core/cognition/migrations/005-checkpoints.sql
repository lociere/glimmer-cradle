CREATE TABLE IF NOT EXISTS loop_checkpoint (
  checkpoint_key TEXT PRIMARY KEY,
  cycle_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
