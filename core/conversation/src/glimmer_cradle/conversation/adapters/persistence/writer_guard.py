"""Conversation Log 的跨进程单写者文件锁。"""

from __future__ import annotations

import os
from pathlib import Path
from typing import BinaryIO


class WriterGuard:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._handle: BinaryIO | None = None

    def acquire(self) -> None:
        if self._handle is not None:
            return
        handle = open(self._path, "a+b")
        try:
            if os.name == "nt":
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(  # type: ignore[attr-defined]
                    handle.fileno(),
                    fcntl.LOCK_EX | fcntl.LOCK_NB,  # type: ignore[attr-defined]
                )
        except OSError as exc:
            handle.close()
            raise RuntimeError("Conversation Log 已有写入者") from exc
        self._handle = handle

    def release(self) -> None:
        handle = self._handle
        if handle is None:
            return
        try:
            if os.name == "nt":
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)  # type: ignore[attr-defined]
        finally:
            handle.close()
            self._handle = None


__all__ = ["WriterGuard"]
