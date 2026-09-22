from __future__ import annotations

from pathlib import Path

import pytest

from glimmer_cradle.conversation.adapters.persistence.writer_guard import WriterGuard


def test_writer_guard_fences_competing_process_owner(tmp_path: Path) -> None:
    lock_path = tmp_path / ".writer.lock"
    first = WriterGuard(lock_path)
    competing = WriterGuard(lock_path)
    first.acquire()
    try:
        with pytest.raises(RuntimeError, match="已有写入者"):
            competing.acquire()
    finally:
        first.release()

    competing.acquire()
    competing.release()
