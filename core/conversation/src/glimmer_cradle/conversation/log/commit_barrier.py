"""副作用与投影消费前必须等待的 durable commit barrier。"""

from __future__ import annotations

from typing import Protocol


class CommitBarrier(Protocol):
    async def flush(self) -> None: ...


__all__ = ["CommitBarrier"]
