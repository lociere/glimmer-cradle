"""Validated Content asset client."""

from __future__ import annotations

import hashlib
from typing import Protocol

from glimmer_cradle.cognition.ports import ContentReference


class ContentTransport(Protocol):
    async def read(self, asset_id: str, *, max_bytes: int) -> bytes: ...


class ContentClient:
    def __init__(self, transport: ContentTransport) -> None:
        self._transport = transport

    async def read(self, reference: ContentReference, *, max_bytes: int) -> bytes:
        if max_bytes < 0 or reference.size_bytes > max_bytes:
            raise ValueError("content exceeds read budget")
        content = await self._transport.read(reference.asset_id, max_bytes=max_bytes)
        if len(content) != reference.size_bytes:
            raise ValueError("content size does not match reference")
        if hashlib.sha256(content).hexdigest() != reference.sha256:
            raise ValueError("content digest does not match reference")
        return content
