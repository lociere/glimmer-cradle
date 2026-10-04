"""Cognition Worker RPC process and lifecycle supervision."""
from __future__ import annotations

import asyncio
import argparse
import base64
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import threading
from typing import Any, Final

import grpc
from google.protobuf.json_format import MessageToDict, ParseDict

from glimmer.common.v1 import service_contract_pb2 as common_pb
from glimmer.cognition.v1 import cognition_service_pb2 as cognition_pb
from glimmer.kernel.v1 import kernel_control_service_pb2 as kernel_pb
from glimmer_cradle.cognition.attention import AttentionController
from glimmer_cradle.cognition.loop import LoopController
from glimmer_cradle.cognition.perception import (
    Observation,
    ObservationNormalizer,
    ObservationQueue,
    PerceptionOperationConflict,
    PerceptionOperationRegistry,
)
from glimmer_cradle.cognition.ports import (
    AgentPlanInput,
    AgentSynthesisInput,
    ConversationHistoryQuery,
    KernelRequestPort,
    KnowledgeEntryInput,
    KnowledgeInitialization,
    KnowledgeRetrievalInput,
    SkillToolDescriptor,
)
from glimmer_cradle.cognition.state import CognitiveActivityController
from glimmer_cradle.cognition.adapters.observability.logger import get_logger
from glimmer_cradle.cognition.adapters.observability.binding import FileObservability
from glimmer_cradle.cognition.adapters.observability.trace_context import (
    TraceContext,
    get_current_span_id,
    get_current_trace_id,
    new_boot_id,
    new_trace_id,
    set_boot_id,
)
from glimmer_cradle.cognition.adapters.paths import (
    ensure_dir,
    resolve_model_invocations_dir,
    resolve_metrics_dir,
    resolve_traces_dir,
)
from glimmer_cradle.cognition.adapters.observability.metrics import start_metrics, stop_metrics
from glimmer_cradle.cognition.adapters.observability.tracer import start_tracer, stop_tracer

invocation_logger = get_logger("model_invocations")

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
        invocation_logger.warning("读取模型调用观测配置失败，回退默认值", error=str(exc))
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
        invocation_logger.warning("写入模型调用观测记录失败", error=str(exc))


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
        files_value = manifest.get("files")
        files: dict[str, Any] = files_value if isinstance(files_value, dict) else {}
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
    assert text is not None
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


transport_logger = get_logger("kernel_cognition_grpc")

_ERROR_KEY = "glimmer-error-bin"
_COGNITION_SERVICE = "glimmer.cognition.v1.CognitionService"
_KERNEL_SERVICE = "glimmer.kernel.v1.KernelControlService"


def _perception_state(state: str) -> int:
    return {
        "accepted": cognition_pb.PERCEPTION_OPERATION_STATE_ACCEPTED,
        "running": cognition_pb.PERCEPTION_OPERATION_STATE_RUNNING,
        "succeeded": cognition_pb.PERCEPTION_OPERATION_STATE_SUCCEEDED,
        "cancelled": cognition_pb.PERCEPTION_OPERATION_STATE_CANCELLED,
        "failed": cognition_pb.PERCEPTION_OPERATION_STATE_FAILED,
    }.get(state, cognition_pb.PERCEPTION_OPERATION_STATE_UNSPECIFIED)


def _struct_dict(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    return MessageToDict(value, preserving_proto_field_name=True)


def _parse_struct(value: dict[str, Any] | None, target: Any) -> None:
    ParseDict(value or {}, target)


class ServiceFault(Exception):
    def __init__(self, code: int, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class KernelServiceError(Exception):
    """Kernel 返回的受控 typed failure；不暴露远端内部异常文本。"""

    def __init__(
        self,
        code: int,
        safe_message: str,
        *,
        retryable: bool = False,
        call: Any = None,
        recovery_actions: tuple[int, ...] = (),
        operation_id: str = "",
    ) -> None:
        super().__init__(safe_message)
        self.code = code
        self.safe_message = safe_message
        self.retryable = retryable
        self.call = call
        self.recovery_actions = recovery_actions
        self.operation_id = operation_id


def _grpc_status(code: int) -> grpc.StatusCode:
    return {
        common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST: grpc.StatusCode.INVALID_ARGUMENT,
        common_pb.SERVICE_ERROR_CODE_NOT_READY: grpc.StatusCode.FAILED_PRECONDITION,
        common_pb.SERVICE_ERROR_CODE_GENERATION_MISMATCH: grpc.StatusCode.PERMISSION_DENIED,
        common_pb.SERVICE_ERROR_CODE_CANCELLED: grpc.StatusCode.CANCELLED,
        common_pb.SERVICE_ERROR_CODE_DEADLINE_EXCEEDED: grpc.StatusCode.DEADLINE_EXCEEDED,
        common_pb.SERVICE_ERROR_CODE_UNAVAILABLE: grpc.StatusCode.UNAVAILABLE,
        common_pb.SERVICE_ERROR_CODE_RECOVERY_REQUIRED: grpc.StatusCode.FAILED_PRECONDITION,
    }.get(code, grpc.StatusCode.INTERNAL)


class CognitionGrpcHost:
    """由 CognitionHost 监督的动态回环 gRPC Service host。"""

    def __init__(
        self,
        *,
        generation: str,
        inbound: KernelRequestPort,
        queue: ObservationQueue,
        activity: CognitiveActivityController,
        cycle: LoopController,
        shutdown: Callable[[], Awaitable[None]],
        operations: PerceptionOperationRegistry,
        workspace: AttentionController,
    ) -> None:
        self.generation = generation
        self._inbound = inbound
        self._queue = queue
        self._activity = activity
        self._cycle = cycle
        self._shutdown = shutdown
        self._operations = operations
        self._workspace = workspace
        self._observation_normalizer = ObservationNormalizer()
        self._server: grpc.aio.Server | None = None
        self._endpoint: str | None = None
        self._phase = "binding"
        self._ready = False
        self._inflight: dict[str, asyncio.Task[Any]] = {}
        self._completed: OrderedDict[str, None] = OrderedDict()

    @property
    def endpoint(self) -> str:
        if self._endpoint is None:
            raise RuntimeError("Cognition gRPC host 尚未绑定")
        return self._endpoint

    async def start(self) -> None:
        if self._server is not None:
            return
        server = grpc.aio.server()
        handlers = {
            "SubmitPerception": self._method(self._submit_perception, cognition_pb.SubmitPerceptionRequest, cognition_pb.SubmitPerceptionResponse),
            "CancelPerception": self._method(self._cancel_perception, cognition_pb.CancelPerceptionRequest, cognition_pb.CancelPerceptionResponse),
            "GetPerceptionOperation": self._method(self._get_perception_operation, cognition_pb.GetPerceptionOperationRequest, cognition_pb.GetPerceptionOperationResponse),
            "InitializeKnowledge": self._method(self._initialize_knowledge, cognition_pb.InitializeKnowledgeRequest, cognition_pb.InitializeKnowledgeResponse),
            "Plan": self._method(self._plan, cognition_pb.PlanRequest, cognition_pb.PlanResponse),
            "Synthesize": self._method(self._synthesize, cognition_pb.SynthesizeRequest, cognition_pb.SynthesizeResponse),
            "GetConversationHistory": self._method(self._history, cognition_pb.GetConversationHistoryRequest, cognition_pb.GetConversationHistoryResponse),
            "Heartbeat": self._method(self._heartbeat, cognition_pb.HeartbeatRequest, cognition_pb.HeartbeatResponse),
            "GetReadiness": self._method(self._readiness, cognition_pb.GetReadinessRequest, cognition_pb.GetReadinessResponse),
            "Shutdown": self._method(self._shutdown_rpc, cognition_pb.ShutdownRequest, cognition_pb.ShutdownResponse),
        }
        server.add_generic_rpc_handlers((grpc.method_handlers_generic_handler(_COGNITION_SERVICE, handlers),))
        port = server.add_insecure_port("127.0.0.1:0")
        if port <= 0:
            raise RuntimeError("Cognition gRPC 动态回环端点绑定失败")
        await server.start()
        self._server = server
        self._endpoint = f"grpc://127.0.0.1:{port}"
        self._phase = "domain_starting"
        transport_logger.info("Cognition gRPC Service 已绑定动态回环端点")

    def mark_ready(self) -> None:
        self._ready = True
        self._phase = "ready"

    async def stop(self) -> None:
        self._ready = False
        self._phase = "stopping"
        for task in tuple(self._inflight.values()):
            if not task.done():
                task.cancel()
        self._inflight.clear()
        if self._server is not None:
            await self._server.stop(grace=1.0)
            await self._server.wait_for_termination(timeout=2.0)
            self._server = None
        self._endpoint = None
        self._phase = "stopped"

    @staticmethod
    def _method(handler: Callable[..., Awaitable[Any]], request_type: Any, response_type: Any) -> Any:
        return grpc.unary_unary_rpc_method_handler(
            handler,
            request_deserializer=request_type.FromString,
            response_serializer=response_type.SerializeToString,
        )

    def _assert_call(self, call: common_pb.CallMetadata | None) -> str:
        if call is None or not call.trace_id:
            raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "缺少调用 trace metadata")
        if call.generation != self.generation:
            raise ServiceFault(common_pb.SERVICE_ERROR_CODE_GENERATION_MISMATCH, "Kernel 调用世代已失效")
        return call.trace_id

    async def _invoke(self, request: Any, context: grpc.aio.ServicerContext, operation: Callable[[str], Awaitable[Any]], *, track: bool = False) -> Any:
        try:
            trace_id = self._assert_call(request.call)
            with TraceContext(trace_id):
                task = asyncio.current_task()
                if track and task is not None:
                    self._inflight[trace_id] = task
                try:
                    return await operation(trace_id)
                finally:
                    if track:
                        self._inflight.pop(trace_id, None)
        except asyncio.CancelledError:
            await self._abort(context, common_pb.SERVICE_ERROR_CODE_CANCELLED, "请求已取消", getattr(request, "call", None))
            raise
        except ServiceFault as fault:
            await self._abort(context, fault.code, str(fault), getattr(request, "call", None), fault.retryable)
        except Exception:
            transport_logger.exception("Cognition gRPC 调用失败")
            await self._abort(context, common_pb.SERVICE_ERROR_CODE_INTERNAL, "Cognition 处理请求失败", getattr(request, "call", None))
        raise RuntimeError("gRPC abort 未终止调用")

    @staticmethod
    async def _abort(context: grpc.aio.ServicerContext, code: int, message: str, call: Any, retryable: bool = False) -> None:
        detail = common_pb.ServiceErrorDetail(code=code, safe_message=message, retryable=retryable)
        if call is not None:
            detail.call.CopyFrom(call)
        context.set_trailing_metadata(((_ERROR_KEY, detail.SerializeToString()),))
        await context.abort(_grpc_status(code), message)

    def _is_completed(self, call: common_pb.CallMetadata) -> bool:
        key = call.idempotency_key
        return bool(key and key in self._completed)

    def _mark_completed(self, call: common_pb.CallMetadata) -> None:
        key = call.idempotency_key
        if not key:
            return
        self._completed[key] = None
        if len(self._completed) > 2048:
            self._completed.popitem(last=False)

    async def _submit_perception(self, request: Any, context: Any) -> Any:
        async def operation(trace_id: str) -> Any:
            operation_id = request.call.idempotency_key or trace_id
            try:
                perception_operation, duplicate = self._operations.accept(operation_id, trace_id)
            except PerceptionOperationConflict as error:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, str(error)) from error
            if not duplicate:
                content = request.content
                payload_digest = request.origin.content_hash.strip() or hashlib.sha256(
                    request.SerializeToString(deterministic=True)
                ).hexdigest()
                model_input = {
                    "text": content.text,
                    "actor_id": content.actor_id or None,
                    "actor_name": content.actor_name or None,
                    "modality": list(content.modality),
                    "items": [MessageToDict(item, preserving_proto_field_name=True) for item in content.items],
                    "parts": [MessageToDict(part, preserving_proto_field_name=True) for part in content.parts],
                }
                conversation = request.conversation
                address_mode = "direct" if request.address_mode == cognition_pb.ADDRESS_MODE_DIRECT else "ambient"
                response_policy = "observe_only" if request.response_policy == cognition_pb.RESPONSE_POLICY_OBSERVE_ONLY else "reply_allowed"
                retention = {
                    cognition_pb.RETENTION_CEILING_TRANSIENT: "transient",
                    cognition_pb.RETENTION_CEILING_MEMORY_CANDIDATE: "memory_candidate",
                }.get(request.retention_ceiling, "experience")
                try:
                    observation = self._observation_normalizer.normalize(Observation(
                        scene_id=conversation.scene_id,
                        conversation_id=conversation.conversation_id,
                        continuity_id=conversation.continuity_id,
                        thread_id=conversation.thread_id,
                        recall_scope=conversation.recall_scope,
                        disclosure_scope=conversation.disclosure_scope,
                        address_mode=address_mode,
                        familiarity=request.familiarity,
                        response_policy=response_policy,
                        text=content.text,
                        trace_id=trace_id,
                        actor_id=content.actor_id or None,
                        actor_name=content.actor_name or None,
                        model_input=model_input,
                        origin=MessageToDict(request.origin, preserving_proto_field_name=True),
                        retention_ceiling=retention,
                        interaction_id=conversation.interaction_id,
                        payload_digest=payload_digest,
                    ))
                except ValueError as error:
                    raise ServiceFault(
                        common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, str(error)
                    ) from error
                dropped = self._queue.put(observation)
                if dropped is not None:
                    self._operations.finish(dropped.trace_id, "failed", "感知队列容量已满")
                if address_mode == "direct":
                    self._activity.engage("direct_perception")
                else:
                    self._activity.observe_activity("ambient_perception")
                self._cycle.notify_external_input()
            return cognition_pb.SubmitPerceptionResponse(
                operation_id=perception_operation.operation_id,
                state=_perception_state(perception_operation.state),
                duplicate=duplicate,
            )
        return await self._invoke(request, context, operation)

    async def _cancel_perception(self, request: Any, context: Any) -> Any:
        async def operation(_trace_id: str) -> Any:
            self._queue.remove(request.target_trace_id)
            await self._workspace.remove_perception(request.target_trace_id)
            perception_operation = await self._operations.cancel(request.target_trace_id)
            if perception_operation is None:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "感知操作不存在")
            return cognition_pb.CancelPerceptionResponse(
                operation_id=perception_operation.operation_id,
                target_trace_id=request.target_trace_id,
                state=_perception_state(perception_operation.state),
                terminal=perception_operation.terminal,
            )
        return await self._invoke(request, context, operation)

    async def _get_perception_operation(self, request: Any, context: Any) -> Any:
        async def operation(_trace_id: str) -> Any:
            perception_operation = self._operations.get(request.operation_id)
            if perception_operation is None:
                raise ServiceFault(common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST, "感知操作不存在")
            return cognition_pb.GetPerceptionOperationResponse(
                operation_id=perception_operation.operation_id,
                state=_perception_state(perception_operation.state),
                terminal=perception_operation.terminal,
                safe_message=perception_operation.safe_message,
            )
        return await self._invoke(request, context, operation)

    async def _initialize_knowledge(self, request: Any, context: Any) -> Any:
        async def operation(trace_id: str) -> Any:
            duplicate = self._is_completed(request.call)
            if not duplicate:
                await self._inbound.on_knowledge_init(KnowledgeInitialization(
                    version=request.version,
                    retrieval=KnowledgeRetrievalInput(
                        mode=request.retrieval.mode or "full_injection",
                        top_k=request.retrieval.top_k or 5,
                        min_score=request.retrieval.min_score,
                        semantic_weight=request.retrieval.semantic_weight,
                    ),
                    entries=[KnowledgeEntryInput(entry_id=e.entry_id, scope=e.scope, content=e.content, enabled=e.enabled, priority=e.priority) for e in request.entries],
                ))
                self._mark_completed(request.call)
            return cognition_pb.InitializeKnowledgeResponse(operation_id=request.call.idempotency_key or trace_id, status="duplicate" if duplicate else "initialized", duplicate=duplicate)
        return await self._invoke(request, context, operation)

    async def _plan(self, request: Any, context: Any) -> Any:
        async def operation(trace_id: str) -> Any:
            output = await self._inbound.on_agent_plan(AgentPlanInput(
                user_goal=request.user_goal,
                scene_id=request.scene_id,
                trace_id=trace_id,
                available_tools=[SkillToolDescriptor(skill_id=t.skill_id, tool_name=t.tool_name, description=t.description, parameters=_struct_dict(t.parameters_schema)) for t in request.available_tools],
            ))
            response = cognition_pb.PlanResponse(summary=output.summary, reasoning=output.reasoning, trace_id=output.trace_id)
            for suggestion in output.suggestions:
                item = response.suggestions.add(skill_id=suggestion.skill_id, tool_name=suggestion.tool_name, purpose=suggestion.purpose, confidence=suggestion.confidence)
                _parse_struct(suggestion.arguments_hint, item.arguments_hint)
            return response
        return await self._invoke(request, context, operation, track=True)

    async def _synthesize(self, request: Any, context: Any) -> Any:
        async def operation(trace_id: str) -> Any:
            output = await self._inbound.on_agent_synthesis(AgentSynthesisInput(
                original_goal=request.original_goal,
                scene_id=request.scene_id,
                conversation=MessageToDict(request.conversation, preserving_proto_field_name=True),
                tool_results=[MessageToDict(item, preserving_proto_field_name=True) for item in request.tool_results],
                trace_id=trace_id,
            ))
            response = cognition_pb.SynthesizeResponse(reply_content=output.reply_content, trace_id=output.trace_id)
            _parse_struct(output.emotion_state, response.emotion_state)
            return response
        return await self._invoke(request, context, operation, track=True)

    async def _history(self, request: Any, context: Any) -> Any:
        async def operation(_trace_id: str) -> Any:
            output = await self._inbound.on_conversation_history(ConversationHistoryQuery(
                request_id=request.request_id,
                conversation_id=request.conversation_id,
                scene_id=request.scene_id,
                thread_id=request.thread_id,
                actor_id=request.actor_id or None,
                actor_name=request.actor_name or None,
                source_provider_id=request.source_provider_id,
                cursor=request.cursor or None,
                limit=request.limit or 50,
                allowed_scopes=list(request.allowed_scopes),
            ))
            response = cognition_pb.GetConversationHistoryResponse(request_id=output.request_id, status=output.status, next_cursor=output.next_cursor or "", has_more=output.has_more, message=output.message or "")
            if output.conversation:
                conversation = output.conversation
                response.conversation.CopyFrom(cognition_pb.ConversationContext(
                    source_provider_id=str(conversation.get("source_provider_id") or ""),
                    scene_id=str(conversation.get("scene_id") or ""),
                    conversation_id=str(conversation.get("conversation_id") or ""),
                    continuity_id=str(conversation.get("continuity_id") or ""),
                    thread_id=str(conversation.get("thread_id") or ""),
                    interaction_id=str(conversation.get("interaction_id") or ""),
                    recall_scope=str(conversation.get("recall_scope") or ""),
                    disclosure_scope=str(conversation.get("disclosure_scope") or ""),
                ))
            for entry in output.items:
                response.items.add(**entry.model_dump(exclude_none=True))
            return response
        return await self._invoke(request, context, operation, track=True)

    async def _heartbeat(self, request: Any, context: Any) -> Any:
        return await self._invoke(request, context, lambda _trace_id: _return(cognition_pb.HeartbeatResponse(status="alive", generation=self.generation)))

    async def _readiness(self, request: Any, context: Any) -> Any:
        return await self._invoke(request, context, lambda _trace_id: _return(cognition_pb.GetReadinessResponse(state="ready" if self._ready else "starting", phase=self._phase, generation=self.generation)))

    async def _shutdown_rpc(self, request: Any, context: Any) -> Any:
        async def operation(trace_id: str) -> Any:
            duplicate = self._is_completed(request.call)
            if not duplicate:
                asyncio.ensure_future(self._shutdown())
                self._mark_completed(request.call)
            return cognition_pb.ShutdownResponse(operation_id=request.call.idempotency_key or trace_id, status="duplicate" if duplicate else "accepted", duplicate=duplicate)
        return await self._invoke(request, context, operation)


async def _return(value: Any) -> Any:
    return value


class KernelGrpcClient:
    """Cognition 进程独占的 KernelControlService client。"""

    def __init__(self, generation: str, registration_nonce: str, registration_secret: bytearray | str) -> None:
        self.generation = generation
        self._registration_nonce = registration_nonce
        self._registration_secret = registration_secret if isinstance(registration_secret, bytearray) else bytearray(
            base64.urlsafe_b64decode(registration_secret + "=" * (-len(registration_secret) % 4))
        )
        self._channel: grpc.aio.Channel | None = None

    async def start(self, kernel_endpoint: str, cognition_endpoint: str) -> None:
        if not kernel_endpoint.startswith("grpc://127.0.0.1:"):
            raise ValueError("Kernel gRPC endpoint 必须是动态回环地址")
        self._channel = grpc.aio.insecure_channel(kernel_endpoint.removeprefix("grpc://"))
        proof_payload = f"{self.generation}\n{self._registration_nonce}\n{cognition_endpoint}\n{os.getpid()}\n{os.getppid()}".encode()
        auth_proof = hmac.new(bytes(self._registration_secret), proof_payload, hashlib.sha256).digest()
        try:
            response = await self._call(
                "RegisterCognition",
                kernel_pb.RegisterCognitionRequest(
                    call=self._call_metadata(),
                    endpoint=cognition_endpoint,
                    process_id=os.getpid(),
                    supervisor_process_id=os.getppid(),
                    registration_nonce=self._registration_nonce,
                    auth_proof=auth_proof,
                ),
                kernel_pb.RegisterCognitionRequest,
                kernel_pb.RegisterCognitionResponse,
            )
        finally:
            self._registration_secret[:] = b"\0" * len(self._registration_secret)
            self._registration_nonce = ""
        if not response.accepted or response.generation != self.generation:
            raise RuntimeError("Kernel 拒绝 Cognition gRPC Service 注册")

    async def stop(self) -> None:
        if self._channel is not None:
            await self._channel.close(grace=1.0)
            self._channel = None

    def _call_metadata(self, trace_id: str | None = None, idempotency_key: str = "") -> common_pb.CallMetadata:
        resolved = trace_id or new_trace_id()
        return common_pb.CallMetadata(trace_id=resolved, correlation_id=resolved, generation=self.generation, idempotency_key=idempotency_key)

    async def send_state_sync(self, state: dict[str, Any]) -> None:
        """Implement KernelEventPort without a stateless forwarding adapter."""
        await self.publish_state(state)

    async def send_log(
        self, level: str, message: str, extra: dict[str, Any] | None = None
    ) -> None:
        await self.publish_log(level, message, extra or {})

    async def send_action_command(self, command: dict[str, Any]) -> None:
        transport_logger.debug(
            "发送 ActionCommand 给 Kernel",
            action_type=command.get("action_type"),
        )
        await self.publish_action(command)

    async def publish_state(self, state: dict[str, Any]) -> None:
        request = kernel_pb.PublishStateRequest(call=self._call_metadata())
        _parse_struct(state, request.state)
        await self._call("PublishState", request, kernel_pb.PublishStateRequest, kernel_pb.PublishStateResponse)

    async def publish_log(self, level: str, message: str, attributes: dict[str, Any]) -> None:
        request = kernel_pb.PublishLogRequest(call=self._call_metadata(), level=level, message=message)
        _parse_struct(attributes, request.attributes)
        await self._call("PublishLog", request, kernel_pb.PublishLogRequest, kernel_pb.PublishLogResponse)

    async def publish_action(self, command: dict[str, Any]) -> None:
        trace_id = str(command.get("trace_id") or new_trace_id())
        target = command.get("target") or {}
        payload = command.get("payload") or {}
        request = kernel_pb.PublishActionRequest(
            call=self._call_metadata(trace_id, f"action:{trace_id}"),
            action_type=str(command.get("action_type") or ""),
            target_scene_id=str(target.get("scene_id") or ""),
            channel_hint=str(target.get("channel_hint") or ""),
            text=str(payload.get("text") or ""),
        )
        for message in payload.get("messages") or []:
            request.messages.add(sequence=int(message.get("sequence") or 0), content_type=str(message.get("content_type") or "text"), text=str(message.get("text") or ""), language=str(message.get("language") or ""))
        for item in payload.get("items") or []:
            request.items.add(type=str(item.get("type") or ""), uri=str(item.get("uri") or ""), mime_type=str(item.get("mime_type") or ""))
        skill = payload.get("skill_request")
        if isinstance(skill, dict):
            request.skill_request.original_goal = str(skill.get("original_goal") or "")
            request.skill_request.capability_kind = str(skill.get("capability_kind") or "")
            request.skill_request.confidence = float(skill.get("confidence") or 0.0)
            request.skill_request.reason = str(skill.get("reason") or "")
            request.skill_request.planning_hint = str(skill.get("planning_hint") or "")
            conversation = skill.get("conversation") or {}
            for field in ("source_provider_id", "scene_id", "conversation_id", "continuity_id", "thread_id", "interaction_id", "recall_scope", "disclosure_scope"):
                setattr(request.skill_request.conversation, field, str(conversation.get(field) or ""))
        _parse_struct(command.get("emotion_state") or {}, request.emotion_state)
        response = await self._call(
            "PublishAction",
            request,
            kernel_pb.PublishActionRequest,
            kernel_pb.PublishActionResponse,
            timeout=None,
        )
        if response.status not in {"completed", "duplicate"}:
            raise KernelServiceError(common_pb.SERVICE_ERROR_CODE_INTERNAL, "Kernel action 未到达终态")

    async def _call(self, method: str, request: Any, request_type: Any, response_type: Any, *, timeout: float | None = 5.0) -> Any:
        if self._channel is None:
            raise RuntimeError("Kernel gRPC client 尚未启动")
        call = self._channel.unary_unary(
            f"/{_KERNEL_SERVICE}/{method}",
            request_serializer=request_type.SerializeToString,
            response_deserializer=response_type.FromString,
        )
        try:
            return await call(request, timeout=timeout)
        except grpc.aio.AioRpcError as error:
            for key, value in error.trailing_metadata() or ():
                if key == _ERROR_KEY and isinstance(value, bytes):
                    detail = common_pb.ServiceErrorDetail()
                    try:
                        detail.ParseFromString(value)
                    except Exception:
                        break
                    raise KernelServiceError(
                        detail.code,
                        detail.safe_message or "Kernel 请求失败",
                        retryable=detail.retryable,
                        call=detail.call if detail.HasField("call") else None,
                        recovery_actions=tuple(detail.recovery_actions),
                        operation_id=detail.operation_id,
                    ) from None
            code = {
                grpc.StatusCode.CANCELLED: common_pb.SERVICE_ERROR_CODE_CANCELLED,
                grpc.StatusCode.DEADLINE_EXCEEDED: common_pb.SERVICE_ERROR_CODE_DEADLINE_EXCEEDED,
                grpc.StatusCode.UNAVAILABLE: common_pb.SERVICE_ERROR_CODE_UNAVAILABLE,
            }.get(error.code(), common_pb.SERVICE_ERROR_CODE_INTERNAL)
            raise KernelServiceError(
                code,
                "Kernel 请求已取消" if code == common_pb.SERVICE_ERROR_CODE_CANCELLED else "Kernel Service 暂不可用",
                retryable=code == common_pb.SERVICE_ERROR_CODE_UNAVAILABLE,
            ) from None



# 初始化模块日志器
logger = get_logger("cognition_host")

STATE_SYNC_FALLBACK_INTERVAL_S = 30.0
STATE_SYNC_LOOP_INTERVAL_S = 5.0


# ======================================
# Cognition 认知核主类
# ======================================
class CognitionHost:
    """
    Cognition 认知核主类，管理整个认知层的完整生命周期。
    核心作用：作为认知层根节点，统一管理所有模块的启动、运行、停止。
    """
    def __init__(
        self,
        config: Any,
        kernel_endpoint: str,
        generation: str,
        registration_nonce: str,
        registration_secret: bytearray,
    ):
        """
        初始化AI核心
        参数：
            config: 内核注入的全局冻结配置
            kernel_endpoint: KernelControlService 动态回环端点
            generation: Kernel 分配给受监督 Cognition 进程的世代
        异常：
            ConfigException: 配置校验失败时抛出
        """
        # 全局冻结配置，会话期不可修改
        self.config: Final[Any] = config
        self.kernel_endpoint: Final[str] = kernel_endpoint
        self.generation: Final[str] = generation
        self.registration_nonce: Final[str] = registration_nonce
        self.registration_secret: bytearray | None = registration_secret
        self.components: Any | None = None
        self.kernel_client: KernelGrpcClient | None = None
        self.cognition_grpc_host: CognitionGrpcHost | None = None
        # 运行状态
        self._is_running: bool = False
        # 主运行任务
        self._main_task: asyncio.Task | None = None
        self._last_state_sync_fingerprint: str | None = None
        self._last_state_sync_at: float = 0.0
        self._shutdown_task: asyncio.Task | None = None
        self._stop_task: asyncio.Task | None = None

        logger.info("Cognition 认知核初始化完成", name=config.manifest.base.name)

    async def start(self) -> None:
        """
        启动AI核心，按顺序初始化所有模块
        规范：幂等性，重复调用不会产生副作用
        """
        if self._is_running:
            logger.warning("Cognition 认知核已在运行中，无需重复启动")
            return
        if self._stop_task is not None and self._stop_task.done():
            self._stop_task = None

        try:
            logger.info("Cognition 认知核开始启动")

            from glimmer_cradle.cognition_worker.composition import compose_cognition

            registration_secret = self.registration_secret
            if registration_secret is None:
                raise RuntimeError("Cognition 注册 capability 已失效")
            self.kernel_client = KernelGrpcClient(
                self.generation,
                self.registration_nonce,
                registration_secret,
            )
            self.components = compose_cognition(
                self.config,
                action_sink=self.kernel_client.send_action_command,
                observability=FileObservability(),
                model_invocation_recorder=record_model_invocation,
            )
            components = self._require_components()
            self.cognition_grpc_host = CognitionGrpcHost(
                generation=self.generation,
                inbound=components.inbound_adapter,
                queue=components.observation_queue,
                activity=components.activity_controller,
                cycle=components.cycle_controller,
                shutdown=self._accept_shutdown_request,
                operations=components.perception_operations,
                workspace=components.workspace,
            )

            # 1.5 启动 Conversation Log 单写者。
            #     先确立进程级 boot_id（telemetry 层用），交互事实流本身是连续的，
            #     不写 SESSION_START/EPOCH_START 这类"生命周期事件" —— 那是 telemetry 的事。
            set_boot_id(new_boot_id())
            conversation_recorder = components.conversation_recorder
            await conversation_recorder.start()

            # 先启动 metrics 与 tracer，保留启动期诊断。
            #     须在记忆/知识加载之前 —— 启动期的 gauge / span 才不会丢。
            await start_metrics(resolve_metrics_dir())
            await start_tracer(resolve_traces_dir())

            # 状态库先于认知活动恢复，保证首拍可读取持久状态与完整 policy。
            await components.state_store.connect()
            await components.planning_store.connect()
            await components.knowledge_store.connect()
            await components.checkpoint_store.connect()
            activity_controller = components.activity_controller
            activity_controller.on_transition(self._request_state_sync)
            await activity_controller.start()

            # 1.66 先连接事实库并恢复投影，认知循环不得在 repository ready 前消费输入。
            cognition_database = components.cognition_database
            await cognition_database.connect()
            await components.turn_controller.connect()
            await components.conversation_controller.connect()
            await components.memory_substrate.load()
            await components.knowledge_base.load_persisted()
            await components.maintenance_scheduler.start()

            # 1.67 启动认知循环。
            await components.cycle_controller.start()

            # 2. 先绑定受监督入站 Service，再向 Kernel 注册动态端点。
            await self.cognition_grpc_host.start()
            await self.kernel_client.start(
                self.kernel_endpoint,
                self.cognition_grpc_host.endpoint,
            )

            # 3. 唤醒当前角色
            character_session = components.character_session
            character_session.wake_up()
            self.cognition_grpc_host.mark_ready()

            # 4. 发出首条状态同步消息。启动快照用于建立 Kernel/Renderer 投影，
            # 不代表一次认知活动状态转换。
            await self._send_state_sync_if_needed(force=True)

            # 5. 标记为运行中
            self._is_running = True

            # 6. 启动主运行循环
            self._main_task = asyncio.create_task(self._main_loop())

            logger.info("Cognition 认知核启动成功，当前角色已醒来")

        except Exception as e:
            logger.critical(f"Cognition 认知核启动失败: {str(e)}", exc_info=True)
            await self.stop()
            raise e
        finally:
            if self.registration_secret is not None:
                self.registration_secret[:] = b"\0" * len(self.registration_secret)
                self.registration_secret = None

    async def stop(self) -> None:
        """并发停机请求共享同一收尾任务，避免信号与 RPC 重复释放资源。"""
        if self._stop_task is None:
            self._stop_task = asyncio.create_task(self._stop_components())
        await asyncio.shield(self._stop_task)

    async def _stop_components(self) -> None:
        """
        停止AI核心，优雅关闭所有资源
        规范：幂等性，重复调用不会报错，必须释放所有资源
        """
        logger.info("Cognition 认知核开始停止")
        self._is_running = False

        # 1. 停止主运行循环
        if self._main_task and not self._main_task.done():
            self._main_task.cancel()
            try:
                await self._main_task
            except asyncio.CancelledError:
                pass

        # 2. 依次停止入站、认知生产者与持久化消费者。
        if self.cognition_grpc_host is not None:
            try:
                await self.cognition_grpc_host.stop()
            except Exception as e:
                logger.error(f"Error stopping Cognition gRPC host: {e}")
            finally:
                self.cognition_grpc_host = None

        if self.components is not None:
            components = self.components
            # 停止认知循环后，Experience 不再产生新的对话 Moment。
            try:
                await components.cycle_controller.stop()
            except Exception as e:
                logger.error(f"Error stopping cognitive loop: {e}")

            try:
                character_session = components.character_session
                character_session.sleep()
            except Exception as e:
                logger.error(f"Error during entity sleep: {e}")

            # 再停认知活动控制器，避免状态 tick 读取已关闭的认知组件。
            try:
                await components.activity_controller.stop()
            except Exception as e:
                logger.error(f"Error stopping cognitive activity controller: {e}")

            # Conversation Log 仍可读时刷新并封口 Episode；未巩固 Episode 会在下次启动后重试。
            try:
                await components.maintenance_scheduler.stop()
            except Exception as e:
                logger.error(f"Error sealing episode projection: {e}")

            # Conversation Log 仍可读时先把 History 投影推进到最终 checkpoint。
            try:
                await components.conversation_controller.close()
            except Exception as e:
                logger.error(f"Error closing conversation store: {e}")

            try:
                await components.turn_controller.close()
            except Exception as e:
                logger.error(f"Error closing conversation turn store: {e}")

            # 最后停止 Conversation Log 单写者。进程关闭属于 telemetry，不写伪造 Moment。
            try:
                conversation_recorder = components.conversation_recorder
                await conversation_recorder.stop()
            except Exception as e:
                logger.error(f"Error stopping conversation recorder: {e}")

            try:
                await components.cognition_database.close()
            except Exception as e:
                logger.error(f"Error closing cognition database: {e}")

            try:
                await components.checkpoint_store.close()
            except Exception as e:
                logger.error(f"Error closing cognition checkpoint store: {e}")

            try:
                await components.knowledge_store.close()
            except Exception as e:
                logger.error(f"Error closing cognition knowledge store: {e}")

            try:
                await components.planning_store.close()
            except Exception as e:
                logger.error(f"Error closing cognition planning store: {e}")

            try:
                await components.state_store.close()
            except Exception as e:
                logger.error(f"Error closing cognition state store: {e}")

            if self.kernel_client is not None:
                try:
                    await self.kernel_client.stop()
                except Exception as e:
                    logger.error(f"Error stopping Kernel gRPC client: {e}")
                finally:
                    self.kernel_client = None

            # 最后刷新遥测，确保上述停机错误仍可被记录。
            try:
                await stop_metrics()
            except Exception as e:
                logger.error(f"Error stopping metrics writer: {e}")
            try:
                await stop_tracer()
            except Exception as e:
                logger.error(f"Error stopping span writer: {e}")

        logger.info("Cognition 认知核已停止，当前角色已进入休眠")

    async def _accept_shutdown_request(self) -> None:
        if self._shutdown_task is None or self._shutdown_task.done():
            self._shutdown_task = asyncio.create_task(self._shutdown_after_ack())

    async def _shutdown_after_ack(self) -> None:
        # 先让 gRPC 返回 ACK，再关闭承载该请求的 Service。
        await asyncio.sleep(0.05)
        await self.stop()
        asyncio.get_running_loop().stop()

    async def _main_loop(self) -> None:
        """主运行循环，保持进程运行，处理心跳和状态同步"""
        logger.info("主运行循环已启动")
        while self._is_running:
            try:
                # 同步当前状态给内核：语义变化立即同步，低频兜底刷新。
                await self._send_state_sync_if_needed()

                await asyncio.sleep(STATE_SYNC_LOOP_INTERVAL_S)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"主运行循环异常: {str(e)}", exc_info=True)
                await asyncio.sleep(1)

    def _request_state_sync(self) -> None:
        if not self._is_running:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self._send_state_sync_if_needed(force=True))

    async def _send_state_sync_if_needed(self, *, force: bool = False) -> None:
        if self.components is None:
            return

        character_session = self.components.character_session
        state = character_session.get_state()
        fingerprint = self._state_sync_fingerprint(state)
        now = asyncio.get_running_loop().time()
        elapsed = now - self._last_state_sync_at

        if (
            not force
            and fingerprint == self._last_state_sync_fingerprint
            and elapsed < STATE_SYNC_FALLBACK_INTERVAL_S
        ):
            return

        if self.kernel_client is None:
            return
        await self.kernel_client.send_state_sync(state)
        self._last_state_sync_fingerprint = fingerprint
        self._last_state_sync_at = now

    def _require_components(self) -> Any:
        if self.components is None:
            raise RuntimeError("Cognition 尚未完成组件组装")
        return self.components

    @staticmethod
    def _state_sync_fingerprint(state: dict) -> str:
        """构建状态同步指纹。

        `cognitive_activity.idle_seconds` 属于持续流逝的时间投影，不应让每秒快照
        都变成语义变化。真正触发同步的是 emotion 与 activity state/policy。
        """
        activity = state.get("cognitive_activity") if isinstance(state, dict) else None
        stable_activity = {}
        if isinstance(activity, dict):
            stable_activity = {
                "state": activity.get("state"),
                "since_at": activity.get("since_at"),
                "policy": activity.get("policy"),
            }

        stable = {
            "name": state.get("name"),
            "is_awake": state.get("is_awake"),
            "emotion": state.get("emotion"),
            "memory_count": state.get("memory_count"),
            "cognitive_activity": stable_activity,
        }
        return json.dumps(stable, sort_keys=True, ensure_ascii=False, default=str)


def _read_supervisor_bootstrap() -> dict[str, str]:
    """从仅由 Kernel 受监督子进程继承的匿名管道读取一次性注册能力。"""
    try:
        with os.fdopen(3, "r", encoding="utf-8", closefd=True) as bootstrap_pipe:
            payload = bootstrap_pipe.readline(16_384)
    except OSError as error:
        raise ValueError("缺少 Kernel 受监督 bootstrap pipe") from error
    value = json.loads(payload)
    if not isinstance(value, dict):
        raise ValueError("Kernel bootstrap payload 格式无效")
    return value


# ======================================
# 命令行启动入口
# ======================================
def main(argv: list[str] | None = None) -> int:
    """
    Cognition 认知核唯一命令行启动入口
    由 Kernel 受监督子进程启动；配置来自参数/环境，注册能力只来自 FD3 匿名管道。
    """
    # 解析命令行参数
    parser = argparse.ArgumentParser(description="Glimmer Cradle Cognition 认知核")
    parser.add_argument(
        "--config-json",
        type=str,
        required=False,
        help="JSON格式的全局配置字符串，由Kernel 内核注入（优先）"
    )
    args = parser.parse_args(argv)

    # 角色配置可通过环境变量注入；endpoint/generation/challenge 不进入环境。
    registration_secret: bytearray | None = None
    try:
        import json

        config_json = args.config_json or os.environ.get("GLIMMER_CRADLE_CONFIG")
        bootstrap = _read_supervisor_bootstrap()
        kernel_endpoint = str(bootstrap.pop("kernelEndpoint"))
        generation = str(bootstrap.pop("generation"))
        registration_nonce = str(bootstrap.pop("registrationNonce"))
        registration_secret_text = str(bootstrap.pop("registrationSecret"))
        registration_secret = bytearray(base64.urlsafe_b64decode(
            registration_secret_text + "=" * (-len(registration_secret_text) % 4)
        ))
        registration_secret_text = ""
        bootstrap.clear()

        if not config_json or not kernel_endpoint or not generation or not registration_nonce or not registration_secret:
            raise ValueError("缺少 Cognition 启动配置、Kernel gRPC endpoint 或 generation")

        config_dict = json.loads(config_json)
        from glimmer_cradle.cognition_worker.composition import (
            map_character_runtime_document,
        )

        config = map_character_runtime_document(config_dict)
    except Exception as e:
        if registration_secret is not None:
            registration_secret[:] = b"\0" * len(registration_secret)
        logger.critical(f"配置解析失败: {str(e)}", exc_info=True)
        return 1

    # 创建认知核实例
    cognition_host = CognitionHost(
        config=config,
        kernel_endpoint=kernel_endpoint,
        generation=generation,
        registration_nonce=registration_nonce,
        registration_secret=registration_secret,
    )

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    exit_code = 0

    # 优雅停机信号
    import signal

    async def shutdown() -> None:
        await cognition_host.stop()
        loop.stop()

    def _register_signal(sig: signal.Signals) -> None:
        try:
            loop.add_signal_handler(sig, lambda: asyncio.create_task(shutdown()))
        except NotImplementedError:
            # Windows 的同步 signal handler 只负责把停机任务投递回事件循环。
            signal.signal(
                sig,
                lambda *_: loop.call_soon_threadsafe(
                    lambda: asyncio.create_task(shutdown())
                ),
            )

    for sig in (signal.SIGINT, signal.SIGTERM):
        _register_signal(sig)

    # 启动认知核
    try:
        loop.run_until_complete(cognition_host.start())
        loop.run_forever()
    except KeyboardInterrupt:
        logger.info("收到停机信号，正在优雅关闭...")
    except Exception as e:
        logger.critical(f"Cognition 认知核运行异常: {str(e)}", exc_info=True)
        exit_code = 1
    finally:
        try:
            if not loop.is_closed():
                loop.run_until_complete(cognition_host.stop())
        except Exception as e:
            logger.critical(f"Cognition 认知核停机异常: {str(e)}", exc_info=True)
            exit_code = 1
        finally:
            loop.close()
            asyncio.set_event_loop(None)
    return exit_code

# 直接运行时启动
if __name__ == "__main__":
    raise SystemExit(main())
