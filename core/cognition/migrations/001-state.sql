CREATE TABLE IF NOT EXISTS cognitive_state (
  state_key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
