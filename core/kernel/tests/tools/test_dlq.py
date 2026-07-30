from __future__ import annotations

import importlib.util
import io
import json
import sqlite3
import stat
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[2] / "tools" / "dlq.py"
SPEC = importlib.util.spec_from_file_location("glimmer_dlq_tool", MODULE_PATH)
assert SPEC and SPEC.loader
dlq = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = dlq
SPEC.loader.exec_module(dlq)


class DlqToolTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.db = root / "kernel.db"
        connection = sqlite3.connect(self.db)
        connection.execute(
            """
            CREATE TABLE dead_letters_ts (
              id INTEGER PRIMARY KEY,
              trace_id TEXT,
              event_type TEXT,
              failure_phase TEXT,
              error_code TEXT,
              owner TEXT,
              source_path TEXT,
              payload TEXT,
              redacted_payload_summary TEXT,
              error_message TEXT,
              stack_trace TEXT,
              retry_policy TEXT,
              replay_command TEXT,
              diagnostic_hint TEXT,
              status TEXT,
              created_at TEXT,
              resolved_at TEXT,
              resolution TEXT,
              replayed INTEGER
            )
            """
        )
        connection.execute(
            "INSERT INTO dead_letters_ts VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "trace-1",
                "event.test",
                "dispatch",
                "failed",
                "kernel",
                "source",
                json.dumps({"token": "secret-value", "value": 1}),
                '{"value":1}',
                "authorization secret-value",
                "secret stack",
                "manual",
                "",
                "",
                "pending",
                "2026-07-01T00:00:00Z",
                "",
                "",
                0,
            ),
        )
        connection.commit()
        connection.close()
        self.original_sources = dlq.SOURCES
        dlq.SOURCES = {
            "kernel": dlq.DlqSource("kernel", self.db, "dead_letters_ts", "error_message")
        }
        self.dispatcher = root / "dispatcher.py"
        self.dispatcher.write_text(
            "#!/usr/bin/env python3\n"
            "import json,sys\n"
            "payload=json.load(sys.stdin)\n"
            "print(json.dumps({'status':'accepted','receipt_id':'receipt-1','trace_id':payload['trace_id']}))\n",
            encoding="utf-8",
        )
        self.dispatcher.chmod(self.dispatcher.stat().st_mode | stat.S_IXUSR)

    def tearDown(self) -> None:
        dlq.SOURCES = self.original_sources
        self.temp.cleanup()

    def test_replay_only_marks_after_real_dispatch_receipt(self) -> None:
        self.assertEqual(
            dlq.cmd_replay(
                ["kernel:1", "--confirm", "--dispatcher", sys.executable, str(self.dispatcher)]
            ),
            0,
        )
        connection = sqlite3.connect(self.db)
        self.assertEqual(
            connection.execute(
                "SELECT status, replayed, resolution FROM dead_letters_ts WHERE id=1"
            ).fetchone(),
            ("replayed", 1, "receipt:receipt-1"),
        )
        connection.close()

    def test_default_show_redacts_payload_and_stack(self) -> None:
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(dlq.cmd_show(["trace-1"]), 0)
        rendered = output.getvalue()
        self.assertNotIn("secret-value", rendered)
        self.assertNotIn("secret stack", rendered)
        self.assertNotIn("authorization", rendered)
        self.assertIn('{"value":1}', rendered)

    def test_failed_dispatch_preserves_pending_evidence(self) -> None:
        self.dispatcher.write_text("raise SystemExit(1)\n", encoding="utf-8")
        self.assertEqual(
            dlq.cmd_replay(
                ["kernel:1", "--confirm", "--dispatcher", sys.executable, str(self.dispatcher)]
            ),
            70,
        )
        connection = sqlite3.connect(self.db)
        self.assertEqual(
            connection.execute(
                "SELECT status, replayed FROM dead_letters_ts WHERE id=1"
            ).fetchone(),
            ("pending", 0),
        )
        connection.close()

    def test_replay_without_confirmation_fails_closed(self) -> None:
        self.assertEqual(
            dlq.cmd_replay(
                ["kernel:1", "--dispatcher", sys.executable, str(self.dispatcher)]
            ),
            77,
        )

    def test_writable_record_rejects_symlinked_database(self) -> None:
        with patch.object(Path, "is_symlink", return_value=True):
            self.assertIsNone(dlq.writable_record("kernel:1"))

    def test_resolve_does_not_make_record_cleanup_eligible(self) -> None:
        self.assertEqual(dlq.cmd_resolve(["kernel:1", "--confirm"]), 0)
        self.assertEqual(dlq.cmd_cleanup(["--days", "0", "--confirm"]), 0)
        connection = sqlite3.connect(self.db)
        self.assertEqual(
            connection.execute(
                "SELECT status, replayed FROM dead_letters_ts WHERE id=1"
            ).fetchone(),
            ("resolved", 0),
        )
        connection.close()

    def test_cleanup_removes_only_successfully_replayed_record(self) -> None:
        self.assertEqual(
            dlq.cmd_replay(
                ["kernel:1", "--confirm", "--dispatcher", sys.executable, str(self.dispatcher)]
            ),
            0,
        )
        self.assertEqual(dlq.cmd_cleanup(["--days", "0", "--confirm"]), 0)
        connection = sqlite3.connect(self.db)
        self.assertIsNone(
            connection.execute(
                "SELECT id FROM dead_letters_ts WHERE id=1"
            ).fetchone()
        )
        connection.close()

    def test_cleanup_retention_starts_at_successful_replay(self) -> None:
        self.assertEqual(
            dlq.cmd_replay(
                ["kernel:1", "--confirm", "--dispatcher", sys.executable, str(self.dispatcher)]
            ),
            0,
        )
        self.assertEqual(dlq.cmd_cleanup(["--days", "30", "--confirm"]), 0)
        connection = sqlite3.connect(self.db)
        self.assertIsNotNone(
            connection.execute(
                "SELECT id FROM dead_letters_ts WHERE id=1"
            ).fetchone()
        )
        connection.close()


if __name__ == "__main__":
    unittest.main()
