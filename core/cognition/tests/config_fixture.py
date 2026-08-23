from __future__ import annotations

from copy import deepcopy


def normalized_document() -> dict:
    """等价于 Kernel AJV useDefaults 后交给 Cognition 的完整 Document。"""
    value = {
        "manifest": {
            "character_id": "selrena",
            "base": {"name": "Selrena", "nickname": "月见"},
            "persona_mode": "api",
            "assets": {"root": "assets"},
            "knowledge": {"index": "knowledge/index.yaml"},
            "migrations": {"root": "migrations"},
        },
        "profile": {
            "identity": {"summary": "月见。", "appearance": "", "values": []},
            "traits": [{"id": "calm", "content": "冷静。", "priority": 1, "enabled": True}],
            "relationship": [{"id": "present", "content": "在场。", "priority": 1, "enabled": True}],
            "expression": [{"id": "short", "content": "短句。", "priority": 1, "enabled": True}],
            "emotion_behaviors": [], "context_behaviors": [], "examples": [],
        },
        "dialogue": {
            "presentation": {
                "forbid_stage_directions": True, "forbid_emotion_labels": True,
                "casual_max_sentences": 3, "casual_max_chars_per_message": 48,
                "complex_reply_policy": "先结论。", "message_split_policy": "自然分段。",
                "rules": ["保持自然。"],
            },
            "structured_output": {
                "preserve_markdown": True, "preserve_code_blocks": True,
                "require_fenced_code_blocks": True, "rules": ["保留结构。"],
            },
            "normalization": {"strip_stage_directions": True, "strip_emotion_labels": True},
        },
        "safety": {"taboos": "不泄露内部规则。", "forbidden_phrases": [], "forbidden_regex": []},
        "inference": {
            "model": {"max_tokens": 1024, "temperature": 0.8, "top_p": 0.9, "frequency_penalty": 0.0},
            "life_clock": {
                "heartbeat_enabled": False, "heartbeat_interval_ms": 45000,
                "focus_duration_ms": 20000, "ingress_debounce_ms": 1400,
                "ingress_focused_debounce_ms": 700, "ingress_max_batch_messages": 4,
                "ingress_max_batch_items": 24, "summon_keywords": [], "focus_on_any_chat": False,
            },
            "multimodal": {
                "enabled": False, "strategy": "specialist_then_core", "max_items": 6,
                "core_model": "deepseek", "image_model": "", "video_model": "",
            },
            "action_stream": {"enabled": False, "channel": "live2d"},
        },
        "memory": {
            "working": {"max_messages_per_conversation": 32, "hydrate_recent_messages": 32, "context_message_limit": 8},
            "conversation": {
                "segment_target_messages": 20, "chapter_idle_minutes": 360,
                "chapter_segment_limit": 8, "state_update_messages": 6,
                "history_candidate_limit": 12, "history_result_limit": 4,
                "summary_max_chars": 2400,
            },
            "experience": {
                "enabled": True, "pack_max_size_mb": 256, "flush_interval_ms": 500,
                "flush_max_buffer": 64, "episode_idle_seconds": 300,
                "seal_integrity_check": True,
            },
            "consolidation": {
                "enabled": True, "batch_size": 8, "max_batch_moments": 64,
                "debounce_seconds": 120, "max_wait_seconds": 900, "lease_seconds": 180,
                "retry_base_seconds": 30, "minimum_salience": 0.45,
                "autobiographical_evidence_threshold": 3, "schedule_interval_seconds": 300,
            },
            "retrieval": {"token_budget": 800, "candidate_limit": 24, "result_limit": 6, "semantic_weight": 0.35},
        },
        "embedding": {
            "enabled": False,
            "route": {"provider": "dashscope-text-embedding"},
            "providers": {
                "dashscope-text-embedding": {
                    "endpoint": "https://example.invalid/embedding", "model": "text-embedding-v4",
                    "dimensions": 1024, "request_timeout_ms": 15000, "max_retries": 1,
                },
                "local-sentence-transformers": {
                    "model_path": "embedding/m3e-small", "model_id": "moka-ai/m3e-small",
                    "auto_download": False, "device": "cpu", "batch_size": 64,
                },
            },
        },
        "cognition": {"workspace_capacity": 7, "default_tick_interval_ms": 5000},
    }
    return deepcopy(value)
