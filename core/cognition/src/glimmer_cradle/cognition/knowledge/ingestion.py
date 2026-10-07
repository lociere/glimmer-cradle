"""受控配置和显式 Resource 采集的确定性 intake；不自动保存工具结果。"""

from __future__ import annotations

import hashlib
import json

from glimmer_cradle.cognition.knowledge.source import (
    KnowledgeResourceCapture,
    KnowledgeResourceSource,
)
from glimmer_cradle.cognition.ports import KnowledgeInitialization
from glimmer_cradle.cognition.ports.resource_port import ResourceSnapshot

RESOURCE_CHUNK_VERSION = "whole-resource.v1"


def resource_capture_from(source: KnowledgeResourceSource, snapshot: ResourceSnapshot) -> KnowledgeResourceCapture:
    access = snapshot.access
    if (
        snapshot.resource_id != source.resource_id
        or snapshot.attributes.get("definition_revision") != source.definition_revision
        or not isinstance(snapshot.content, bytes)
        or len(snapshot.content) > 32 * 1024
        or hashlib.sha256(snapshot.content).hexdigest() != snapshot.revision
        or access is None or access.source_id != source.source_id
        or any(not isinstance(value, str) or not value.strip() for value in
               (access.access_id, access.principal_id, access.permission_revision))
        or type(access.collected_at_ms) is not int or type(access.expires_at_ms) is not int
        or not 0 <= access.collected_at_ms < access.expires_at_ms <= 2**53 - 1
    ):
        raise ValueError("Knowledge resource evidence invalid")
    text = snapshot.content.decode("utf-8").strip()
    if snapshot.media_type == "text/plain":
        parser = "utf8-trim-text.v1"
    elif snapshot.media_type == "application/json":
        def reject_constant(value: str) -> None:
            raise ValueError("Knowledge JSON non-finite value")

        def unique_object(pairs: list[tuple[str, object]]) -> dict:
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("Knowledge JSON duplicate key")
                result[key] = value
            return result

        value = json.loads(text, parse_constant=reject_constant, object_pairs_hook=unique_object)
        text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
        parser = "utf8-canonical-json.v1"
    else:
        raise ValueError("Knowledge resource media unsupported")
    if not text or len(text.encode("utf-8")) > 32 * 1024:
        raise ValueError("Knowledge resource material empty or oversized")
    return KnowledgeResourceCapture(source, snapshot, text, parser, RESOURCE_CHUNK_VERSION)


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
