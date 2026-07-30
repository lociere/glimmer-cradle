from __future__ import annotations

import importlib.util
import io
import json
import sqlite3
import stat
import shutil
import sys
import tempfile
import threading
import time
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
                json.dumps({
                    "event_type": "event.test",
                    "event_id": "event-1",
                    "token": "secret-value",
                    "value": 1,
                }),
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
            "print(json.dumps({'status':'success','receipt_id':'receipt-1',"
            "'source':payload['source'],'record_id':payload['id'],'owner':payload['owner'],"
            "'event_type':payload['event_type'],'trace_id':payload['trace_id'],"
            "'payload_digest':payload['payload_digest'],'operation_id':payload['operation_id'],"
            "'dispatcher_id':payload['dispatcher_id'],"
            "'delivery':'kernel_event_bus_published'}))\n",
            encoding="utf-8",
        )
        self.dispatcher.chmod(self.dispatcher.stat().st_mode | stat.S_IXUSR)
        self.original_dispatchers = dlq.DISPATCHERS
        dlq.DISPATCHERS = {
            "kernel.fixture": dlq.DispatcherRegistration(
                "kernel.fixture",
                "kernel",
                ("kernel",),
                (sys.executable, str(self.dispatcher)),
            )
        }

    def tearDown(self) -> None:
        dlq.SOURCES = self.original_sources
        dlq.DISPATCHERS = self.original_dispatchers
        self.temp.cleanup()

    def test_replay_only_marks_after_real_dispatch_receipt(self) -> None:
        self.assertEqual(
            dlq.cmd_replay(
                ["kernel:1", "--confirm", "--dispatcher", "kernel.fixture"]
            ),
            0,
        )
        connection = sqlite3.connect(self.db)
        status, replayed, resolution = connection.execute(
            "SELECT status, replayed, resolution FROM dead_letters_ts WHERE id=1"
        ).fetchone()
        self.assertEqual((status, replayed), ("replayed", 1))
        self.assertTrue(resolution.startswith("receipt:receipt-1:dlq_replay_"))
        connection.close()

    def test_registered_kernel_dispatcher_delivers_payload_to_durable_ingress(self) -> None:
        node = shutil.which("node")
        self.assertIsNotNone(node)
        dispatcher = MODULE_PATH.with_name("dlq-replay-dispatcher.mjs")
        dlq.DISPATCHERS = {
            "kernel.event-bus.v1": dlq.DispatcherRegistration(
                "kernel.event-bus.v1",
                "kernel",
                ("kernel",),
                (str(node), str(dispatcher)),
            )
        }
        data_root = Path(self.temp.name) / "data"
        delivery = threading.Thread(
            target=self._complete_kernel_delivery,
            args=(data_root,),
            daemon=True,
        )
        delivery.start()
        with patch.dict(
            "os.environ",
            {
                "GLIMMER_CRADLE_DATA_ROOT": str(data_root),
                "GLIMMER_CRADLE_DLQ_REPLAY_TIMEOUT_MS": "2000",
            },
        ):
            self.assertEqual(
                dlq.cmd_replay(
                    [
                        "kernel:1",
                        "--confirm",
                        "--dispatcher",
                        "kernel.event-bus.v1",
                    ]
                ),
                0,
            )
        delivery.join(timeout=2)
        self.assertFalse(delivery.is_alive())
        queued = list(
            (data_root / "state" / "kernel" / "dlq-replay-inbox").glob("*.json")
        )
        self.assertEqual(len(queued), 1)
        envelope = json.loads(queued[0].read_text(encoding="utf-8"))
        self.assertEqual(envelope["source"], "kernel")
        self.assertEqual(envelope["record_id"], 1)
        self.assertEqual(envelope["event_type"], "event.test")
        self.assertEqual(
            json.loads(envelope["payload_json"])["event_id"],
            "event-1",
        )

    def _complete_kernel_delivery(self, data_root: Path) -> None:
        inbox = data_root / "state" / "kernel" / "dlq-replay-inbox"
        deadline = time.monotonic() + 2
        queued: Path | None = None
        while time.monotonic() < deadline:
            matches = list(inbox.glob("dlq_replay_*.json"))
            if matches:
                queued = matches[0]
                break
            time.sleep(0.01)
        if queued is None:
            return
        envelope = json.loads(queued.read_text(encoding="utf-8"))
        processed = inbox / "processed"
        processed.mkdir(parents=True, exist_ok=True)
        receipt = {
            "status": "success",
            "receipt_id": f"kernel_event_bus_{envelope['operation_id']}",
            "source": envelope["source"],
            "record_id": envelope["record_id"],
            "owner": envelope["owner"],
            "event_type": envelope["event_type"],
            "trace_id": envelope["trace_id"],
            "payload_digest": envelope["payload_digest"],
            "operation_id": envelope["operation_id"],
            "dispatcher_id": envelope["dispatcher_id"],
            "delivery": "kernel_event_bus_published",
        }
        (processed / f"{envelope['operation_id']}.receipt.json").write_text(
            json.dumps(receipt),
            encoding="utf-8",
        )

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
                ["kernel:1", "--confirm", "--dispatcher", "kernel.fixture"]
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
                ["kernel:1", "--dispatcher", "kernel.fixture"]
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
                ["kernel:1", "--confirm", "--dispatcher", "kernel.fixture"]
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
                ["kernel:1", "--confirm", "--dispatcher", "kernel.fixture"]
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

    def test_arbitrary_dispatcher_command_is_not_executable(self) -> None:
        self.assertEqual(
            dlq.cmd_replay(
                ["kernel:1", "--confirm", "--dispatcher", sys.executable, str(self.dispatcher)]
            ),
            2,
        )

    def test_owner_mismatch_is_rejected_before_dispatch(self) -> None:
        connection = sqlite3.connect(self.db)
        connection.execute("UPDATE dead_letters_ts SET owner='cognition' WHERE id=1")
        connection.commit()
        connection.close()
        self.assertEqual(
            dlq.cmd_replay(["kernel:1", "--confirm", "--dispatcher", "kernel.fixture"]),
            77,
        )

    def test_receipt_must_bind_record_trace_payload_and_operation(self) -> None:
        self.dispatcher.write_text(
            "import json,sys\n"
            "payload=json.load(sys.stdin)\n"
            "print(json.dumps({'status':'success','receipt_id':'forged',"
            "'source':payload['source'],'record_id':payload['id'],"
            "'owner':payload['owner'],'trace_id':'wrong',"
            "'payload_digest':payload['payload_digest'],"
            "'operation_id':payload['operation_id'],"
            "'dispatcher_id':payload['dispatcher_id']}))\n",
            encoding="utf-8",
        )
        self.assertEqual(
            dlq.cmd_replay(["kernel:1", "--confirm", "--dispatcher", "kernel.fixture"]),
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


if __name__ == "__main__":
    unittest.main()
