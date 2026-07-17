from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.observability.trace_context import get_current_span_id, get_current_trace_id
from glimmer_cradle.cognition.foundation.path_utils import ensure_dir, resolve_model_invocations_dir

logger = get_logger("model_invocations")

_SECRET_KEYWORDS = ("api_key", "authorization", "token", "secret")
_SECRET_PATTERNS = [
    (re.compile(r"Bearer\s+[A-Za-z0-9._-]+", re.IGNORECASE), "Bearer [REDACTED]"),
    (re.compile(r"sk-[A-Za-z0-9_-]+"), "[REDACTED_API_KEY]"),
]
_ARTIFACT_WRITE_LOCK = threading.Lock()
_SEQUENCE_PREFIX = re.compile(r"^(\d{3,})_")
_ARTIFACT_CATEGORY_DIRECTORIES = {
    "decision": "01-action-decision",
    "skill": "02-skill-planning",
    "response": "03-final-response",
    "memory": "04-memory",
    "other": "99-other",
}


@dataclass(frozen=True)
class ModelInvocationSettings:
    capture_mode: str = "summary"
    full_retention_days: int = 3
    redact_secrets: bool = True


def record_model_invocation(
    *,
    invocation_id: str,
    purpose: str,
    capture_category: str,
    provider_id: str,
    model_id: str,
    prompt_text: str,
    normalized_text: str,
    duration_ms: float,
    outcome: str,
    scene_id: str | None = None,
    module: str = "inference",
    owner: str = "cognition",
    runtime_id: str = "cognition",
    provider_payload: Any = None,
    raw_response: Any = None,
    error_code: str | None = None,
    error_summary: str | None = None,
    attributes: dict[str, Any] | None = None,
    trace_id: str | None = None,
) -> dict[str, Any] | None:
    settings = load_model_invocation_settings()
    if settings.capture_mode == "off":
        return None

    invocation_dir = _resolve_model_invocations_dir()
    ensure_dir(invocation_dir)
    record: dict[str, Any] = {
        "timestamp": _now_iso(),
        "invocation_id": invocation_id,
        "capture_mode": settings.capture_mode,
        "purpose": purpose or "unspecified",
        "capture_category": _normalize_capture_category(capture_category),
        "owner": owner,
        "module": module,
        "runtime_id": runtime_id,
        "trace_id": trace_id or get_current_trace_id() or "",
        "span_id": get_current_span_id(),
        "scene_id": scene_id or None,
        "provider_id": provider_id,
        "model_id": model_id,
        "outcome": outcome,
        "duration_ms": round(max(duration_ms, 0.0), 3),
        "prompt_chars": len(prompt_text),
        "response_chars": len(normalized_text),
        "prompt_hash": _hash_text(prompt_text),
        "response_hash": _hash_text(normalized_text),
        "provider_payload_ref": None,
        "raw_response_ref": None,
        "prompt_text_ref": None,
        "response_text_ref": None,
        "normalized_text_ref": None,
        "error_code": error_code,
        "error_summary": _redact_text(error_summary) if error_summary else None,
        "redacted": settings.redact_secrets,
        "schema_version": "2.0.0",
        "attributes": _redact_json(attributes or {}) if settings.redact_secrets else (attributes or {}),
    }

    if settings.capture_mode == "full":
        _write_full_capture_bundle(
            record=record,
            prompt_text=prompt_text,
            normalized_text=normalized_text,
            provider_payload=provider_payload,
            raw_response=raw_response,
            redact=settings.redact_secrets,
        )

    _append_jsonl(invocation_dir / "records" / "cognition.jsonl", record)
    return record


def load_model_invocation_settings() -> ModelInvocationSettings:
    raw = os.environ.get("GLIMMER_CRADLE_OBSERVABILITY")
    if not raw:
        return ModelInvocationSettings()
    try:
        payload = json.loads(raw)
        capture = payload.get("model_invocations") if isinstance(payload, dict) else None
        if not isinstance(capture, dict):
            return ModelInvocationSettings()
        capture_mode = str(capture.get("capture_mode") or "summary").strip() or "summary"
        if capture_mode not in {"off", "summary", "full"}:
            capture_mode = "summary"
        full_retention_days = int(capture.get("full_retention_days") or 3)
        redact_secrets = bool(capture.get("redact_secrets", True))
        return ModelInvocationSettings(
            capture_mode=capture_mode,
            full_retention_days=max(full_retention_days, 1),
            redact_secrets=redact_secrets,
        )
    except Exception as exc:
        logger.warning("读取模型调用观测配置失败，回退默认值", error=str(exc))
        return ModelInvocationSettings()


def _resolve_model_invocations_dir() -> Path:
    configured = os.environ.get("GLIMMER_CRADLE_OBSERVABILITY_DIR")
    if configured:
        return Path(configured) / "model-invocations"
    return resolve_model_invocations_dir()


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    try:
        ensure_dir(path.parent)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
    except Exception as exc:
        logger.warning("写入模型调用观测记录失败", error=str(exc))


def _write_full_capture_bundle(
    *,
    record: dict[str, Any],
    prompt_text: str,
    normalized_text: str,
    provider_payload: Any,
    raw_response: Any,
    redact: bool,
) -> None:
    invocation_root = _resolve_model_invocations_dir()
    timestamp = str(record["timestamp"])
    date_segment = timestamp[:10]
    trace_segment = _safe_path_segment(str(record.get("trace_id") or ""), fallback="untraced", max_length=96)
    purpose_segment = _safe_path_segment(str(record.get("purpose") or "unspecified"), fallback="unspecified", max_length=48)
    category = _normalize_capture_category(str(record.get("capture_category") or "other"))
    invocation_id = str(record["invocation_id"])
    time_segment = timestamp[11:].replace(":", "-")
    trace_dir = ensure_dir(invocation_root / "captures" / date_segment / f"trace-{trace_segment}")
    category_dir = ensure_dir(trace_dir / _ARTIFACT_CATEGORY_DIRECTORIES[category])

    with _ARTIFACT_WRITE_LOCK:
        sequence = _next_capture_sequence(trace_dir)
        invocation_dir = ensure_dir(
            category_dir / f"{sequence:03d}_{time_segment}_{purpose_segment}_{invocation_id[:8]}"
        )
        record["prompt_text_ref"] = _write_text_capture(
            invocation_dir,
            "10-prompt.txt",
            prompt_text,
            redact=redact,
        )
        record["response_text_ref"] = _write_text_capture(
            invocation_dir,
            "20-response.txt",
            normalized_text,
            redact=redact,
        )
        record["normalized_text_ref"] = record["response_text_ref"]
        if provider_payload is not None:
            record["provider_payload_ref"] = _write_json_capture(
                invocation_dir,
                "30-provider-request.json",
                provider_payload,
                redact=redact,
            )
        if raw_response is not None:
            record["raw_response_ref"] = _write_json_capture(
                invocation_dir,
                "40-provider-response.json",
                raw_response,
                redact=redact,
            )

        manifest = {
            "schema_version": "2.0.0",
            "sequence": sequence,
            "timestamp": timestamp,
            "trace_id": record.get("trace_id") or "",
            "span_id": record.get("span_id"),
            "invocation_id": invocation_id,
            "purpose": record.get("purpose"),
            "capture_category": category,
            "scene_id": record.get("scene_id"),
            "provider_id": record.get("provider_id"),
            "model_id": record.get("model_id"),
            "outcome": record.get("outcome"),
            "duration_ms": record.get("duration_ms"),
            "prompt_chars": record.get("prompt_chars"),
            "response_chars": record.get("response_chars"),
            "files": {
                "prompt": _relative_name(record.get("prompt_text_ref")),
                "response": _relative_name(record.get("response_text_ref")),
                "provider_request": _relative_name(record.get("provider_payload_ref")),
                "provider_response": _relative_name(record.get("raw_response_ref")),
            },
        }
        _write_json_capture(invocation_dir, "00-manifest.json", manifest, redact=False)
        _rebuild_trace_timeline(trace_dir)


def _next_capture_sequence(trace_dir: Path) -> int:
    highest = 0
    for category_dir in trace_dir.iterdir():
        if not category_dir.is_dir():
            continue
        for entry in category_dir.iterdir():
            if not entry.is_dir():
                continue
            match = _SEQUENCE_PREFIX.match(entry.name)
            if match:
                highest = max(highest, int(match.group(1)))
    return highest + 1


def _rebuild_trace_timeline(trace_dir: Path) -> None:
    manifests: list[tuple[Path, dict[str, Any]]] = []
    for category_dir in sorted(trace_dir.iterdir(), key=lambda item: item.name):
        if not category_dir.is_dir():
            continue
        for entry in category_dir.iterdir():
            if not entry.is_dir() or not _SEQUENCE_PREFIX.match(entry.name):
                continue
            manifest_path = entry / "00-manifest.json"
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            if isinstance(manifest, dict):
                manifests.append((entry, manifest))
    manifests.sort(key=lambda item: int(item[1].get("sequence") or 0))

    trace_id = str(manifests[0][1].get("trace_id") or "") if manifests else ""
    lines = [
        "# 模型调用时间线",
        "",
        f"- Trace ID: `{_markdown_cell(trace_id or 'untraced')}`",
        f"- 调用数: {len(manifests)}",
        "",
        "| 顺序 | 分类 | UTC 时间 | Purpose | Model | Outcome | 耗时 | 输入 | 输出 |",
        "| ---: | --- | --- | --- | --- | --- | ---: | --- | --- |",
    ]
    for entry, manifest in manifests:
        sequence = int(manifest.get("sequence") or 0)
        duration = manifest.get("duration_ms")
        duration_text = f"{duration} ms" if isinstance(duration, (int, float)) else "-"
        files = manifest.get("files") if isinstance(manifest.get("files"), dict) else {}
        prompt_name = files.get("prompt")
        response_name = files.get("response")
        relative_dir = entry.relative_to(trace_dir).as_posix()
        prompt_link = f"[查看](./{relative_dir}/{prompt_name})" if prompt_name else "-"
        response_link = f"[查看](./{relative_dir}/{response_name})" if response_name else "-"
        lines.append(
            "| "
            + " | ".join([
                f"{sequence:03d}",
                _markdown_cell(str(manifest.get("capture_category") or "other")),
                _markdown_cell(str(manifest.get("timestamp") or "")),
                _markdown_cell(str(manifest.get("purpose") or "")),
                _markdown_cell(str(manifest.get("model_id") or "")),
                _markdown_cell(str(manifest.get("outcome") or "")),
                duration_text,
                prompt_link,
                response_link,
            ])
            + " |"
        )
    (trace_dir / "timeline.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _safe_path_segment(value: str, *, fallback: str, max_length: int) -> str:
    source = value.strip()
    if not source:
        return fallback
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "-", source).strip(".-_")
    if not normalized:
        suffix = hashlib.sha256(source.encode("utf-8")).hexdigest()[:8]
        return f"{fallback}-{suffix}"
    if normalized != source or len(normalized) > max_length:
        suffix = hashlib.sha256(source.encode("utf-8")).hexdigest()[:8]
        normalized = f"{normalized[:max_length - 9]}-{suffix}"
    return normalized[:max_length]


def _normalize_capture_category(value: str) -> str:
    return value if value in _ARTIFACT_CATEGORY_DIRECTORIES else "other"


def _relative_name(reference: Any) -> str | None:
    if not isinstance(reference, str) or not reference:
        return None
    return reference.rsplit("/", 1)[-1]


def _markdown_cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def _write_text_capture(directory: Path, name: str, content: str, *, redact: bool) -> str:
    text = _redact_text(content) if redact else content
    target = directory / name
    target.write_text(text, encoding="utf-8")
    return target.relative_to(_resolve_model_invocations_dir()).as_posix()


def _write_json_capture(directory: Path, name: str, payload: Any, *, redact: bool) -> str:
    content = _redact_json(payload) if redact else payload
    target = directory / name
    target.write_text(json.dumps(content, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return target.relative_to(_resolve_model_invocations_dir()).as_posix()


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest() if text else ""


def _redact_json(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            if any(secret in key.lower() for secret in _SECRET_KEYWORDS):
                redacted[key] = "[REDACTED]"
                continue
            redacted[key] = _redact_json(item)
        return redacted
    if isinstance(value, list):
        return [_redact_json(item) for item in value]
    if isinstance(value, str):
        return _redact_text(value)
    return value


def _redact_text(text: str | None) -> str | None:
    if text is None:
        return None
    redacted = text
    for pattern, replacement in _SECRET_PATTERNS:
        redacted = pattern.sub(replacement, redacted)
    return redacted


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
