CREATE TABLE IF NOT EXISTS knowledge_entry (
  entry_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  scope TEXT NOT NULL DEFAULT 'knowledge',
  source TEXT NOT NULL,
  activation_json TEXT NOT NULL DEFAULT '{}',
  deleted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS knowledge_revision (
  entry_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  priority INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  source TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(entry_id, revision)
);
CREATE TABLE IF NOT EXISTS knowledge_embedding (
  owner_id TEXT NOT NULL,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(owner_id, model)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_active
  ON knowledge_entry(enabled, deleted_at, priority DESC);
