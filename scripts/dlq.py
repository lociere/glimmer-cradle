"""
DLQ CLI — 死信队列查询与标记工具

用法:
  python scripts/dlq.py list [--limit N]          列出最近的死信记录
  python scripts/dlq.py show <trace_id>           按 trace_id 查询
  python scripts/dlq.py replay <source:id>        标记某条记录为已重放

source:
  cognition  data/state/cognition/dead_letters.db:dead_letters
  kernel     data/state/kernel/kernel.db:dead_letters_ts
"""
from __future__ import annotations

import json
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class DlqSource:
    name: str
    db_path: Path
    table: str
    error_column: str


SOURCES: dict[str, DlqSource] = {
    "cognition": DlqSource(
        name="cognition",
        db_path=REPO_ROOT / "data" / "state" / "cognition" / "dead_letters.db",
        table="dead_letters",
        error_column="exception",
    ),
    "kernel": DlqSource(
        name="kernel",
        db_path=REPO_ROOT / "data" / "state" / "kernel" / "kernel.db",
        table="dead_letters_ts",
        error_column="error_message",
    ),
}


def open_existing(source: DlqSource, *, writable: bool = False) -> sqlite3.Connection | None:
    if not source.db_path.exists():
        return None

    if writable:
        return sqlite3.connect(source.db_path)

    uri = f"file:{source.db_path.as_posix()}?mode=ro"
    return sqlite3.connect(uri, uri=True)


def has_table(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    return row is not None


def normalize_row(source: DlqSource, row: sqlite3.Row) -> dict:
    return {
        "source": source.name,
        "id": row["id"],
        "trace_id": row["trace_id"],
        "event_type": row["event_type"],
        "failure_phase": row["failure_phase"] if "failure_phase" in row.keys() else "",
        "error_code": row["error_code"] if "error_code" in row.keys() else "",
        "owner": row["owner"] if "owner" in row.keys() else source.name,
        "source_path": row["source_path"] if "source_path" in row.keys() else "",
        "payload": row["payload"],
        "payload_summary": row["redacted_payload_summary"] if "redacted_payload_summary" in row.keys() else "",
        "exception": row[source.error_column],
        "stack_trace": row["stack_trace"],
        "retry_policy": row["retry_policy"] if "retry_policy" in row.keys() else "",
        "replay_command": row["replay_command"] if "replay_command" in row.keys() else "",
        "diagnostic_hint": row["diagnostic_hint"] if "diagnostic_hint" in row.keys() else "",
        "status": row["status"] if "status" in row.keys() else ("replayed" if row["replayed"] else "pending"),
        "created_at": row["created_at"],
        "resolved_at": row["resolved_at"] if "resolved_at" in row.keys() else "",
        "resolution": row["resolution"] if "resolution" in row.keys() else "",
        "replayed": bool(row["replayed"]),
    }


def query_source_recent(source: DlqSource, limit: int) -> list[dict]:
    conn = open_existing(source)
    if conn is None:
        return []
    try:
        conn.row_factory = sqlite3.Row
        if not has_table(conn, source.table):
            return []
        if source.name == "kernel":
            rows = conn.execute(
                f"""
                SELECT id, trace_id, event_type, failure_phase, error_code, owner, source_path,
                       payload, redacted_payload_summary, {source.error_column}, stack_trace,
                       retry_policy, replay_command, diagnostic_hint, status, created_at,
                       resolved_at, resolution, replayed
                  FROM {source.table}
                 WHERE status != 'resolved'
                 ORDER BY created_at DESC
                 LIMIT ?
                """,
                (limit,),
            ).fetchall()
        else:
            rows = conn.execute(
                f"""
                SELECT id, trace_id, event_type, payload, {source.error_column},
                       stack_trace, created_at, replayed
                  FROM {source.table}
                 WHERE replayed = 0
                 ORDER BY created_at DESC
                 LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [normalize_row(source, row) for row in rows]
    finally:
        conn.close()


def query_source_by_trace(source: DlqSource, trace_id: str) -> list[dict]:
    conn = open_existing(source)
    if conn is None:
        return []
    try:
        conn.row_factory = sqlite3.Row
        if not has_table(conn, source.table):
            return []
        if source.name == "kernel":
            rows = conn.execute(
                f"""
                SELECT id, trace_id, event_type, failure_phase, error_code, owner, source_path,
                       payload, redacted_payload_summary, {source.error_column}, stack_trace,
                       retry_policy, replay_command, diagnostic_hint, status, created_at,
                       resolved_at, resolution, replayed
                  FROM {source.table}
                 WHERE trace_id = ?
                 ORDER BY created_at DESC
                """,
                (trace_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                f"""
                SELECT id, trace_id, event_type, payload, {source.error_column},
                       stack_trace, created_at, replayed
                  FROM {source.table}
                 WHERE trace_id = ?
                 ORDER BY created_at DESC
                """,
                (trace_id,),
            ).fetchall()
        return [normalize_row(source, row) for row in rows]
    finally:
        conn.close()


def query_recent(limit: int) -> list[dict]:
    records = [
        record
        for source in SOURCES.values()
        for record in query_source_recent(source, limit)
    ]
    records.sort(key=lambda item: item["created_at"], reverse=True)
    return records[:limit]


def query_by_trace(trace_id: str) -> list[dict]:
    return [
        record
        for source in SOURCES.values()
        for record in query_source_by_trace(source, trace_id)
    ]


def print_records(records: Iterable[dict]) -> None:
    rows = list(records)
    if not rows:
        print("DLQ 为空，无死信记录。")
        return

    print(f"{'Ref':<18} {'Trace ID':<38} {'Event Type':<28} {'Status':<12} {'Error':<36} {'Time'}")
    print("-" * 170)
    for row in rows:
        ref = f"{row['source']}:{row['id']}"
        error_short = (row["exception"] or "")[:34]
        print(
            f"{ref:<18} {row['trace_id']:<38} {row['event_type']:<28} {row['status']:<12} "
            f"{error_short:<36} {row['created_at']}"
        )
    replayed = sum(1 for row in rows if row["replayed"])
    print(f"\n共 {len(rows)} 条记录（已重放: {replayed}）")


def cmd_list(args: list[str]) -> int:
    limit = 20
    if len(args) >= 2 and args[0] == "--limit":
        limit = int(args[1])
    print_records(query_recent(limit))
    return 0


def cmd_show(args: list[str]) -> int:
    if not args:
        print("用法: python scripts/dlq.py show <trace_id>")
        return 2

    records = query_by_trace(args[0])
    if not records:
        print(f"未找到 trace_id={args[0]} 的记录。")
        return 0

    for row in records:
        print(f"\n{'=' * 60}")
        print(f"Ref:         {row['source']}:{row['id']}")
        print(f"Trace ID:    {row['trace_id']}")
        print(f"Event Type:  {row['event_type']}")
        if row["failure_phase"]:
            print(f"Phase:       {row['failure_phase']}")
        if row["error_code"]:
            print(f"Error Code:  {row['error_code']}")
        print(f"Status:      {row['status']}")
        print(f"Error:       {row['exception']}")
        print(f"Time:        {row['created_at']}")
        print(f"Replayed:    {row['replayed']}")
        if row["diagnostic_hint"]:
            print(f"Hint:        {row['diagnostic_hint']}")
        if row["replay_command"]:
            print(f"Replay:      {row['replay_command']}")
        if row["payload_summary"]:
            print("\nPayload Summary:")
            print(row["payload_summary"])
        print("\nPayload:")
        try:
            print(json.dumps(json.loads(row["payload"]), indent=2, ensure_ascii=False))
        except (json.JSONDecodeError, TypeError):
            print(row["payload"])
        if row["stack_trace"]:
            print("\nStack Trace:")
            print(row["stack_trace"][:500])
    return 0


def parse_record_ref(record_ref: str) -> tuple[DlqSource, int] | None:
    if ":" not in record_ref:
        return None
    source_name, raw_id = record_ref.split(":", 1)
    source = SOURCES.get(source_name)
    if source is None:
        return None
    try:
        return source, int(raw_id)
    except ValueError:
        return None


def cmd_replay(args: list[str]) -> int:
    if not args:
        print("用法: python scripts/dlq.py replay <source:id>")
        return 2

    parsed = parse_record_ref(args[0])
    if parsed is None:
        print("记录引用必须形如 cognition:1 或 kernel:1。")
        return 2

    source, record_id = parsed
    conn = open_existing(source, writable=True)
    if conn is None:
        print(f"{source.name} DLQ 数据库不存在：{source.db_path}")
        return 1
    try:
        if not has_table(conn, source.table):
            print(f"{source.name} DLQ 表不存在：{source.table}")
            return 1
        if source.name == "kernel":
            resolved_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            conn.execute(
                f"""
                UPDATE {source.table}
                   SET replayed = 1,
                       status = 'replayed',
                       resolved_at = ?,
                       resolution = CASE
                         WHEN resolution IS NULL OR resolution = '' THEN 'replayed'
                         ELSE resolution
                       END
                 WHERE id = ?
                """,
                (resolved_at, record_id),
            )
        else:
            conn.execute(f"UPDATE {source.table} SET replayed = 1 WHERE id = ?", (record_id,))
        conn.commit()
        print(f"记录 {source.name}:{record_id} 已标记为已重放。")
        return 0
    finally:
        conn.close()


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 0

    command, args = argv[1], argv[2:]
    if command == "list":
        return cmd_list(args)
    if command == "show":
        return cmd_show(args)
    if command == "replay":
        return cmd_replay(args)

    print(f"未知命令: {command}")
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
