CREATE TABLE IF NOT EXISTS planning_decision (
    decision_id INTEGER PRIMARY KEY AUTOINCREMENT,
    trace_id TEXT NOT NULL,
    scene_id TEXT NOT NULL,
    original_goal TEXT NOT NULL,
    planned_goal TEXT NOT NULL,
    action TEXT NOT NULL,
    capability_kind TEXT NOT NULL,
    reason TEXT NOT NULL,
    confidence REAL NOT NULL,
    planning_hint TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_planning_decision_trace
    ON planning_decision(trace_id, decision_id DESC);
