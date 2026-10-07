"""Native reader material decoder; RPC/authorization and durable receipt belong to CapabilityClient."""

import hashlib

from glimmer_cradle.cognition.ports import ResourceSnapshot


def resource_snapshot_from_result(output: dict, definition_id: str, definition_revision: str) -> ResourceSnapshot:
    """Validate actual Log material, not a supplier response or an invented resource.read RPC."""
    text = output.get("content_utf8")
    if output.get("reference") != {"id": definition_id, "revision": definition_revision}:
        raise ValueError("native resource definition mismatch")
    if not isinstance(text, str) or len(text.encode("utf-8")) > 32 * 1024:
        raise ValueError("native resource content invalid")
    content = text.encode("utf-8")
    revision = hashlib.sha256(content).hexdigest()
    media_type = output.get("media_type")
    if output.get("content_revision") != revision or media_type not in {"text/plain", "application/json"}:
        raise ValueError("native resource content revision/media invalid")
    return ResourceSnapshot(definition_id, revision, media_type, content,
        {"definition_revision": definition_revision})
