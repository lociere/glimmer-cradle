"""Deterministic shared test adapters for Cognition."""

from __future__ import annotations

import asyncio
import hashlib
from copy import deepcopy
from contextlib import contextmanager
from datetime import datetime, timezone

from glimmer_cradle.cognition_worker.rpc_service import (
    TraceContext,
    get_current_trace_id,
)


def normalized_document() -> dict:
    """等价于 Kernel AJV useDefaults 后交给 Worker 的完整 Document。"""
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


class TestClock:
    def __init__(self) -> None:
        self.value = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)

    def now(self) -> datetime:
        return datetime.now(timezone.utc)

    def now_iso(self) -> str:
        return self.now().isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def monotonic(self) -> float:
        return self.now().timestamp()

    async def wait(self, seconds: float) -> None:
        await asyncio.sleep(seconds)


class TestIds:
    def __init__(self) -> None:
        self._next = 0

    def new(self) -> str:
        self._next += 1
        return f"{self._next:032x}"

    def stable(self, namespace: str, value: str) -> str:
        return hashlib.sha256(f"{namespace}:{value}".encode()).hexdigest()[:32]


class RecordingLogger:
    def __init__(self, records: list[tuple[str, str, dict]], name: str) -> None:
        self._records = records
        self._name = name

    def _record(self, level: str, event: str, values: dict) -> None:
        self._records.append((level, f"{self._name}:{event}", values))

    def debug(self, event: str, **values) -> None: self._record("debug", event, values)
    def info(self, event: str, **values) -> None: self._record("info", event, values)
    def warning(self, event: str, **values) -> None: self._record("warning", event, values)
    def error(self, event: str, **values) -> None: self._record("error", event, values)
    def critical(self, event: str, **values) -> None: self._record("critical", event, values)


class RecordingSpan:
    def __init__(self) -> None:
        self.attributes: dict = {}
        self.events: list[tuple[str, dict | None]] = []

    def set_attribute(self, name: str, value) -> None:
        self.attributes[name] = value

    def add_event(self, name: str, attributes: dict | None = None) -> None:
        self.events.append((name, attributes))


class RecordingObservability:
    def __init__(self) -> None:
        self.logs: list[tuple[str, str, dict]] = []
        self.metrics: list[tuple[str, str, float, dict | None]] = []
        self._ids = TestIds()

    def logger(self, module_name: str) -> RecordingLogger:
        return RecordingLogger(self.logs, module_name)

    def counter(self, name: str, value: float = 1, labels: dict | None = None) -> None:
        self.metrics.append(("counter", name, value, labels))

    def gauge(self, name: str, value: float, labels: dict | None = None) -> None:
        self.metrics.append(("gauge", name, value, labels))

    def histogram(self, name: str, value: float, labels: dict | None = None) -> None:
        self.metrics.append(("histogram", name, value, labels))

    @contextmanager
    def span(self, name: str, *, attributes: dict | None = None):
        span = RecordingSpan()
        span.attributes.update(attributes or {})
        yield span

    def trace_context(self, trace_id: str):
        return TraceContext(trace_id)

    def new_trace_id(self) -> str:
        return self._ids.new()

    def current_trace_id(self) -> str | None:
        return get_current_trace_id()


CLOCK = TestClock()
IDS = TestIds()
OBSERVABILITY = RecordingObservability()


def recorder_args() -> dict:
    return {"clock": CLOCK, "ids": IDS, "observability": OBSERVABILITY}


def build_experience_recorder(base_dir, **kwargs):
    from glimmer_cradle.conversation import (
        build_conversation_recorder as build,
    )

    return build(base_dir, **recorder_args(), **kwargs)
