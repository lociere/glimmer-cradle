"""
DLQ CLI — 死信队列查询与标记工具

用法:
  python core/kernel/tools/dlq.py list [--limit N]
  python core/kernel/tools/dlq.py show <trace_id> [--raw --confirm]
  python core/kernel/tools/dlq.py replay <source:id> --confirm --dispatcher <registered-id>
  python core/kernel/tools/dlq.py resolve <source:id> --confirm
  python core/kernel/tools/dlq.py cleanup --days N --confirm

source:
  cognition  data/state/cognition/dead_letters.db:dead_letters
  kernel     data/state/kernel/kernel.db:dead_letters_ts
"""
from __future__ import annotations

import json
import hashlib
import os
import secrets
import sqlite3
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class DlqSource:
    name: str
    db_path: Path
    table: str
    error_column: str


@dataclass(frozen=True)
class DispatcherRegistration:
    dispatcher_id: str
    owner: str
    sources: tuple[str, ...]
    command: tuple[str, ...]


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

# 只有对应 owner 在代码审查中注册的 adapter 才能执行。当前仓库尚未有可在离线 CLI
# 中正确重建 runtime event class 与订阅关系的 adapter，因此生产默认失败闭合；测试通过
# 注入同一 registration contract 验证 receipt 绑定，不能用任意 --dispatcher 命令绕过。
DISPATCHERS: dict[str, DispatcherRegistration] = {}


def open_existing(source: DlqSource, *, writable: bool = False) -> sqlite3.Connection | None:
    if (
        not source.db_path.exists()
        or source.db_path.is_symlink()
        or not source.db_path.is_file()
    ):
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
        error_short = (row["error_code"] or "[REDACTED]")[:34]
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
        print("用法: python core/kernel/tools/dlq.py show <trace_id>")
        return 2

    raw = "--raw" in args
    confirmed = "--confirm" in args
    if raw and (not confirmed or (os.name != "nt" and os.geteuid() != 0)):
        print("raw payload 需要 root 与 --confirm；默认查询保持脱敏。")
        return 77
    trace_id = next((arg for arg in args if not arg.startswith("--")), "")
    records = query_by_trace(trace_id)
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
        print(f"Error:       {row['exception'] if raw else (row['error_code'] or '[REDACTED]')}")
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
        if raw:
            print(json.dumps({"event": "dlq_raw_access", "source": row["source"], "id": row["id"]}))
            try:
                print(json.dumps(json.loads(row["payload"]), indent=2, ensure_ascii=False))
            except (json.JSONDecodeError, TypeError):
                print(row["payload"])
        else:
            print(row["payload_summary"] or "[REDACTED]")
        if row["stack_trace"] and raw:
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


def writable_record(record_ref: str) -> tuple[DlqSource, int, sqlite3.Connection, sqlite3.Row] | None:
    parsed = parse_record_ref(record_ref)
    if parsed is None:
        return None
    source, record_id = parsed
    if (
        not source.db_path.exists()
        or source.db_path.is_symlink()
        or not source.db_path.is_file()
    ):
        return None
    stat = source.db_path.stat()
    if os.name != "nt" and stat.st_uid != os.geteuid():
        raise PermissionError(f"DLQ owner mismatch: {source.db_path}")
    conn = open_existing(source, writable=True)
    if conn is None or not has_table(conn, source.table):
        if conn is not None:
            conn.close()
        return None
    conn.row_factory = sqlite3.Row
    row = conn.execute(f"SELECT * FROM {source.table} WHERE id = ?", (record_id,)).fetchone()
    if row is None:
        conn.close()
        return None
    return source, record_id, conn, row


def cmd_replay(args: list[str]) -> int:
    if "--confirm" not in args:
        return 77
    if not args or "--dispatcher" not in args:
        print("用法: python core/kernel/tools/dlq.py replay <source:id> --confirm --dispatcher <registered-id>")
        return 2
    dispatcher_index = args.index("--dispatcher")
    if dispatcher_index + 1 >= len(args) or dispatcher_index + 2 != len(args):
        return 2
    dispatcher_id = args[dispatcher_index + 1]
    registration = DISPATCHERS.get(dispatcher_id)
    if registration is None or not registration.command:
        print(json.dumps({"event": "dlq_replay_denied", "error_code": "dispatcher_not_registered"}))
        return 66
    loaded = writable_record(args[0])
    if loaded is None:
        print("记录不存在、owner 不匹配或 DLQ 表不可用。")
        return 66
    source, record_id, conn, row = loaded
    try:
        row_owner = row["owner"] if "owner" in row.keys() else source.name
        if (
            row_owner != source.name
            or registration.owner != row_owner
            or source.name not in registration.sources
        ):
            print(json.dumps({"event": "dlq_replay_denied", "error_code": "owner_mismatch"}))
            return 77
        raw_payload = str(row["payload"])
        payload_digest = hashlib.sha256(raw_payload.encode("utf-8")).hexdigest()
        operation_id = f"dlq_replay_{secrets.token_hex(16)}"
        payload = {
            "source": source.name,
            "id": record_id,
            "owner": row_owner,
            "event_type": row["event_type"],
            "trace_id": row["trace_id"],
            "payload": json.loads(raw_payload),
            "payload_digest": payload_digest,
            "operation_id": operation_id,
            "dispatcher_id": registration.dispatcher_id,
        }
        completed = subprocess.run(
            registration.command,
            input=json.dumps(payload, ensure_ascii=False),
            text=True,
            capture_output=True,
            check=False,
        )
        if completed.returncode != 0:
            print(json.dumps({"event": "dlq_replay_failed", "exit_code": completed.returncode}))
            return 70
        try:
            receipt = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return 70
        expected_receipt = {
            "source": source.name,
            "record_id": record_id,
            "owner": row_owner,
            "trace_id": row["trace_id"],
            "payload_digest": payload_digest,
            "operation_id": operation_id,
            "dispatcher_id": registration.dispatcher_id,
        }
        if (
            receipt.get("status") != "success"
            or not receipt.get("receipt_id")
            or any(receipt.get(key) != value for key, value in expected_receipt.items())
        ):
            print(json.dumps({"event": "dlq_replay_failed", "error_code": "receipt_mismatch"}))
            return 70
        replayed_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        if source.name == "kernel":
            conn.execute(
                f"""
                UPDATE {source.table}
                   SET replayed = 1,
                       status = 'replayed',
                       resolved_at = ?,
                       resolution = ?
                 WHERE id = ?
                """,
                (
                    replayed_at,
                    f"receipt:{receipt['receipt_id']}:{operation_id}:{payload_digest}",
                    record_id,
                ),
            )
        else:
            conn.execute(f"UPDATE {source.table} SET replayed = 1 WHERE id = ?", (record_id,))
        conn.commit()
        print(json.dumps({"event": "dlq_replayed", "ref": f"{source.name}:{record_id}", "receipt": receipt}))
        return 0
    finally:
        conn.close()


def cmd_resolve(args: list[str]) -> int:
    if not args or "--confirm" not in args:
        return 77
    loaded = writable_record(args[0])
    if loaded is None:
        return 66
    source, record_id, conn, _ = loaded
    try:
        if source.name == "kernel":
            resolved_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            conn.execute(
                f"UPDATE {source.table} SET status='resolved', resolved_at=?, resolution='manual' WHERE id=?",
                (resolved_at, record_id),
            )
        else:
            print("该 legacy DLQ 缺少独立 resolve 元数据，拒绝把 resolve 伪装成 replay。")
            return 66
        conn.commit()
        return 0
    finally:
        conn.close()


def cmd_cleanup(args: list[str]) -> int:
    if "--confirm" not in args or "--days" not in args:
        return 77
    try:
        days = int(args[args.index("--days") + 1])
    except (IndexError, ValueError):
        return 64
    if days < 0:
        return 64
    cutoff = datetime.now(timezone.utc).timestamp() - days * 86400
    removed = 0
    for source in SOURCES.values():
        if (
            not source.db_path.exists()
            or source.db_path.is_symlink()
            or not source.db_path.is_file()
        ):
            continue
        stat = source.db_path.stat()
        if os.name != "nt" and stat.st_uid != os.geteuid():
            print(f"DLQ owner mismatch: {source.db_path}")
            return 77
        conn = open_existing(source, writable=True)
        if conn is None or not has_table(conn, source.table):
            if conn is not None:
                conn.close()
            continue
        try:
            if source.name != "kernel":
                # legacy cognition DLQ 没有 replay receipt timestamp；在 schema 迁移前保留证据。
                continue
            rows = conn.execute(
                f"SELECT id, resolved_at, replayed FROM {source.table}"
            ).fetchall()
            for record_id, replayed_at, replayed in rows:
                try:
                    replayed_timestamp = datetime.fromisoformat(
                        str(replayed_at).replace("Z", "+00:00")
                    ).timestamp()
                except (TypeError, ValueError):
                    continue
                if replayed and replayed_timestamp < cutoff:
                    conn.execute(f"DELETE FROM {source.table} WHERE id=?", (record_id,))
                    removed += 1
            conn.commit()
        finally:
            conn.close()
    print(json.dumps({"event": "dlq_cleanup", "removed": removed}))
    return 0


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
    if command == "resolve":
        return cmd_resolve(args)
    if command == "cleanup":
        return cmd_cleanup(args)

    print(f"未知命令: {command}")
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
