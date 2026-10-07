CREATE TABLE knowledge_entry (
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
CREATE TABLE knowledge_revision (
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
CREATE TABLE knowledge_embedding (
  owner_id TEXT NOT NULL,
  model TEXT NOT NULL,
  entry_revision INTEGER NOT NULL,
  content_digest TEXT NOT NULL,
  transformation_version TEXT NOT NULL,
  dim INTEGER NOT NULL CHECK(dim > 0 AND dim <= 65536),
  vector BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(owner_id, model),
  FOREIGN KEY(owner_id, entry_revision) REFERENCES knowledge_revision(entry_id, revision)
);
CREATE INDEX idx_knowledge_active
  ON knowledge_entry(enabled, deleted_at, priority DESC);

CREATE TABLE knowledge_resource_source (
  source_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision > 0),
  declaration_json TEXT NOT NULL
);
CREATE TABLE knowledge_resource_revision (
  entry_id TEXT NOT NULL,
  entry_revision INTEGER NOT NULL,
  source_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  raw_content BLOB NOT NULL,
  parser_version TEXT NOT NULL,
  chunk_version TEXT NOT NULL,
  PRIMARY KEY(entry_id, entry_revision),
  FOREIGN KEY(entry_id, entry_revision) REFERENCES knowledge_revision(entry_id, revision),
  FOREIGN KEY(source_id) REFERENCES knowledge_resource_source(source_id)
);

PRAGMA application_id = 1195592526;
PRAGMA user_version = 2;
