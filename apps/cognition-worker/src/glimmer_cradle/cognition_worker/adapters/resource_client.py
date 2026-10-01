"""Versioned resource client implementing Cognition's ResourcePort."""

from __future__ import annotations

import base64

from glimmer_cradle.cognition.ports import ResourceSnapshot
from glimmer_cradle.cognition_worker.adapters.capability_client import RequestTransport


class ResourceClient:
    def __init__(self, transport: RequestTransport) -> None:
        self._transport = transport

    async def read(
        self,
        resource_id: str,
        *,
        revision: str | None,
        principal_id: str,
    ) -> ResourceSnapshot:
        response = await self._transport.request(
            "resource.read",
            {"resource_id": resource_id, "revision": revision, "principal_id": principal_id},
        )
        actual_id, actual_revision, media_type, encoded = (
            response.get("resource_id"), response.get("revision"),
            response.get("media_type"), response.get("content_base64"),
        )
        attributes = response.get("attributes", {})
        if not all(isinstance(value, str) and value for value in (
            actual_id, actual_revision, media_type, encoded
        )) or not isinstance(attributes, dict):
            raise ValueError("invalid resource snapshot")
        return ResourceSnapshot(
            resource_id=actual_id,
            revision=actual_revision,
            media_type=media_type,
            content=base64.b64decode(encoded, validate=True),
            attributes=attributes,
        )
