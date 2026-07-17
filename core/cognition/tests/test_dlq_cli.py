"""统一 DLQ CLI 测试 —— 同时查询 Cognition / Kernel 两侧死信源。"""
from __future__ import annotations

import importlib.util
import sqlite3
import sys
from pathlib import Path


def load_dlq_module():
    repo_root = Path(__file__).resolve().parents[3]
    module_path = repo_root / "scripts" / "dlq.py"
    spec = importlib.util.spec_from_file_location("selrena_test_dlq_cli", module_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def create_cognition_dlq(path: Path) -> None:
    conn = sqlite3.connect(path)
    try:
        conn.execute(
            """
            CREATE TABLE dead_letters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                exception TEXT NOT NULL,
                stack_trace TEXT,
                created_at TEXT NOT NULL,
                replayed INTEGER DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            INSERT INTO dead_letters
              (trace_id, event_type, payload, exception, stack_trace, created_at)
            VALUES ('trace-c', 'CognitionEvent', '{}', 'cognition failed', '', '2026-06-03T10:00:00')
            """
        )
        conn.commit()
    finally:
        conn.close()


def create_kernel_dlq(path: Path) -> None:
    conn = sqlite3.connect(path)
    try:
        conn.execute(
            """
            CREATE TABLE dead_letters_ts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                failure_phase TEXT NOT NULL DEFAULT '',
                error_code TEXT NOT NULL DEFAULT '',
                owner TEXT NOT NULL DEFAULT 'kernel',
                source_path TEXT NOT NULL DEFAULT '',
                payload TEXT NOT NULL,
                redacted_payload_summary TEXT NOT NULL DEFAULT '',
                error_message TEXT NOT NULL,
                stack_trace TEXT,
                retry_policy TEXT NOT NULL DEFAULT '',
                replay_command TEXT NOT NULL DEFAULT '',
                diagnostic_hint TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                resolved_at TEXT NOT NULL DEFAULT '',
                resolution TEXT NOT NULL DEFAULT '',
                replayed INTEGER DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            INSERT INTO dead_letters_ts
              (trace_id, event_type, failure_phase, error_code, owner, source_path, payload,
               redacted_payload_summary, error_message, stack_trace, retry_policy,
               replay_command, diagnostic_hint, status, created_at)
            VALUES ('trace-k', 'KernelEvent', 'dispatch', 'E_KERNEL', 'kernel', 'event-bus',
                    '{}', '{}', 'kernel failed', '', 'manual', 'pnpm dlq:replay',
                    '检查 Kernel 事件处理器', 'pending', '2026-06-03T11:00:00')
            """
        )
        conn.commit()
    finally:
        conn.close()


def test_dlq_cli_reads_both_sources(tmp_path: Path) -> None:
    dlq = load_dlq_module()
    cognition_db = tmp_path / "cognition.db"
    kernel_db = tmp_path / "kernel.db"
    create_cognition_dlq(cognition_db)
    create_kernel_dlq(kernel_db)

    dlq.SOURCES = {
        "cognition": dlq.DlqSource("cognition", cognition_db, "dead_letters", "exception"),
        "kernel": dlq.DlqSource("kernel", kernel_db, "dead_letters_ts", "error_message"),
    }

    records = dlq.query_recent(10)

    assert [record["source"] for record in records] == ["kernel", "cognition"]
    assert records[0]["exception"] == "kernel failed"
    assert records[1]["exception"] == "cognition failed"


def test_dlq_cli_marks_replay_by_source_ref(tmp_path: Path) -> None:
    dlq = load_dlq_module()
    kernel_db = tmp_path / "kernel.db"
    create_kernel_dlq(kernel_db)

    dlq.SOURCES = {
        "kernel": dlq.DlqSource("kernel", kernel_db, "dead_letters_ts", "error_message"),
    }

    assert dlq.cmd_replay(["kernel:1"]) == 0

    conn = sqlite3.connect(kernel_db)
    try:
        replayed = conn.execute("SELECT replayed FROM dead_letters_ts WHERE id = 1").fetchone()[0]
    finally:
        conn.close()
    assert replayed == 1
