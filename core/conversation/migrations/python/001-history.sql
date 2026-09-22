CREATE TABLE schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE projection_meta(name TEXT PRIMARY KEY,position INTEGER NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE conversation_threads(
  conversation_id TEXT NOT NULL, thread_id TEXT NOT NULL, scene_id TEXT NOT NULL,
  recall_scope TEXT NOT NULL, disclosure_scope TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(conversation_id,thread_id)
);
CREATE TABLE conversation_messages(
  position INTEGER PRIMARY KEY, moment_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL, chapter_id TEXT, scene_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  interaction_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL, actor_id TEXT, actor_name TEXT, occurred_at TEXT NOT NULL,
  importance REAL NOT NULL, recall_scope TEXT NOT NULL, disclosure_scope TEXT NOT NULL,
  FOREIGN KEY(conversation_id,thread_id)
    REFERENCES conversation_threads(conversation_id,thread_id)
);
CREATE INDEX idx_conversation_messages_thread
  ON conversation_messages(conversation_id,thread_id,position DESC);
CREATE TABLE conversation_chapters(
  chapter_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  sequence INTEGER NOT NULL, status TEXT NOT NULL,
  first_position INTEGER NOT NULL, last_position INTEGER NOT NULL,
  started_at TEXT NOT NULL, ended_at TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
  UNIQUE(conversation_id,thread_id,sequence)
);
CREATE INDEX idx_conversation_chapters_active
  ON conversation_chapters(conversation_id,thread_id,status,last_position);
CREATE TABLE conversation_segments(
  segment_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL, level INTEGER NOT NULL, parent_segment_id TEXT,
  first_position INTEGER NOT NULL, last_position INTEGER NOT NULL,
  summary TEXT NOT NULL, keywords_json TEXT NOT NULL, actor_ids_json TEXT NOT NULL,
  recall_scope TEXT NOT NULL, disclosure_scope TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(conversation_id,thread_id,level,first_position,last_position)
);
CREATE INDEX idx_conversation_segments_lookup
  ON conversation_segments(conversation_id,thread_id,level,last_position DESC);
CREATE TABLE conversation_segment_members(
  segment_id TEXT NOT NULL,position INTEGER NOT NULL,
  PRIMARY KEY(segment_id,position)
);
CREATE TABLE conversation_state(
  conversation_id TEXT NOT NULL,thread_id TEXT NOT NULL,
  version INTEGER NOT NULL,through_position INTEGER NOT NULL,
  state_json TEXT NOT NULL,updated_at TEXT NOT NULL,
  PRIMARY KEY(conversation_id,thread_id)
);
