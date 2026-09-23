"""Evidence provenance rules for durable memory revisions."""

from __future__ import annotations

from typing import Any, Iterable


def normalize_evidence(items: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deduplicate evidence by Moment identity and reject ungrounded revisions."""
    evidence_by_id = {
        str(item.get("moment_id") or ""): dict(item)
        for item in items
        if str(item.get("moment_id") or "")
    }
    if not evidence_by_id:
        raise ValueError("记忆修订必须携带 Moment 证据")
    return list(evidence_by_id.values())
