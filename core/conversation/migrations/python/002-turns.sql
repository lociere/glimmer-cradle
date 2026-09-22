CREATE TABLE IF NOT EXISTS conversation_turns(
  turn_id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  continuity_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  recall_scope TEXT NOT NULL,
  disclosure_scope TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('accepted','running','completed','interrupted','failed')),
  revision INTEGER NOT NULL CHECK(revision > 0),
  accepted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  terminal_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_conversation_turns_thread
  ON conversation_turns(conversation_id,thread_id,accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_turns_status
  ON conversation_turns(status,updated_at);
