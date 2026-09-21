CREATE TABLE IF NOT EXISTS conversation_bindings(
  binding_key TEXT PRIMARY KEY,
  source_provider_id TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  continuity_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  recall_scope TEXT NOT NULL,
  disclosure_scope TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_bindings_conversation
  ON conversation_bindings(conversation_id, thread_id);

