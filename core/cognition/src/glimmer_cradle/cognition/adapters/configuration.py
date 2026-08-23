"""Kernel 注入配置 Document 到 Cognition 内部 settings 的边界映射。"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from glimmer_cradle.cognition.domain.configuration import (
    CharacterManifestSettings,
    CharacterProfileSettings,
    CharacterRuntimeSettings,
    CognitionSettings,
    DialoguePolicySettings,
    EmbeddingSettings,
    InferenceSettings,
    LLMSettings,
    MemorySettings,
    SafetySettings,
    SettingsNode,
)


_MEMORY_DEFAULTS: dict[str, Any] = {
    "working": {
        "max_messages_per_conversation": 32,
        "hydrate_recent_messages": 32,
        "context_message_limit": 8,
    },
    "conversation": {
        "segment_target_messages": 20,
        "chapter_idle_minutes": 360,
        "chapter_segment_limit": 8,
        "state_update_messages": 6,
        "history_candidate_limit": 12,
        "history_result_limit": 4,
        "summary_max_chars": 2400,
    },
    "experience": {
        "enabled": True,
        "pack_max_size_mb": 256,
        "flush_interval_ms": 500,
        "flush_max_buffer": 64,
        "episode_idle_seconds": 300,
        "seal_integrity_check": True,
    },
    "consolidation": {
        "enabled": True,
        "batch_size": 8,
        "max_batch_moments": 64,
        "debounce_seconds": 120,
        "max_wait_seconds": 900,
        "lease_seconds": 180,
        "retry_base_seconds": 30,
        "minimum_salience": 0.45,
        "autobiographical_evidence_threshold": 3,
        "schedule_interval_seconds": 300,
    },
    "retrieval": {
        "token_budget": 800,
        "candidate_limit": 24,
        "result_limit": 6,
        "semantic_weight": 0.35,
    },
}

_COGNITION_DEFAULTS = {
    "workspace_capacity": 7,
    "default_tick_interval_ms": 5000,
}


def _merge(defaults: Mapping[str, Any], value: Mapping[str, Any] | None) -> dict[str, Any]:
    result: dict[str, Any] = {}
    incoming = dict(value or {})
    for key, default in defaults.items():
        actual = incoming.pop(key, None)
        if isinstance(default, Mapping):
            result[key] = _merge(default, actual if isinstance(actual, Mapping) else None)
        else:
            result[key] = default if actual is None else actual
    result.update(incoming)
    return result


def map_character_runtime_document(document: Mapping[str, Any]) -> CharacterRuntimeSettings:
    required = ("manifest", "profile", "dialogue", "safety", "inference")
    missing = [key for key in required if not isinstance(document.get(key), Mapping)]
    if missing:
        raise ValueError(f"Cognition 配置缺少必需 Document: {', '.join(missing)}")
    return CharacterRuntimeSettings(
        manifest=CharacterManifestSettings(document["manifest"]),
        profile=CharacterProfileSettings(document["profile"]),
        dialogue=DialoguePolicySettings(document["dialogue"]),
        safety=SafetySettings(document["safety"]),
        inference=InferenceSettings(document["inference"]),
        llm=LLMSettings(document["llm"]) if isinstance(document.get("llm"), Mapping) else None,
        memory=MemorySettings(_merge(_MEMORY_DEFAULTS, document.get("memory"))),
        embedding=(
            EmbeddingSettings(document["embedding"])
            if isinstance(document.get("embedding"), Mapping)
            else None
        ),
        cognition=CognitionSettings(_merge(_COGNITION_DEFAULTS, document.get("cognition"))),
    )


def map_settings_document(document: Mapping[str, Any]) -> SettingsNode:
    """测试与 Adapter contract 使用的单一 Document 映射入口。"""
    return SettingsNode(document)
