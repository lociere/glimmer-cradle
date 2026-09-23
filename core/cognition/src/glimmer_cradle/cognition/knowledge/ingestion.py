"""Authorized Knowledge configuration ingestion."""

from __future__ import annotations

from glimmer_cradle.cognition.ports.kernel.models import KnowledgeInitialization


def config_entries_from(payload: KnowledgeInitialization) -> list[dict]:
    return [
        {
            "entry_id": entry.entry_id,
            "content": entry.content.strip(),
            "priority": entry.priority,
            "enabled": entry.enabled,
        }
        for entry in payload.entries
        if entry.scope == "knowledge" and entry.enabled and entry.content.strip()
    ]
