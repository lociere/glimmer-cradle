import json
from pathlib import Path

import glimmer_cradle.cognition_worker.adapters.model_client as llm_module
import pytest
from conftest import normalized_document
from glimmer_cradle.cognition.inference import ModelSettings
from glimmer_cradle.cognition_worker import rpc_service as process
from glimmer_cradle.cognition_worker.adapters.model_client import (
    LLMApiResult,
    LLMEngine,
    LLMSettings,
    ModelMessage,
    ModelRequest,
)
from glimmer_cradle.cognition_worker.composition import (
    compose_cognition,
    map_character_runtime_document,
)
from glimmer_cradle.cognition_worker.rpc_service import KernelGrpcClient


def test_main_returns_failure_for_missing_kernel_injection(monkeypatch) -> None:
    monkeypatch.delenv("GLIMMER_CRADLE_CONFIG", raising=False)
    monkeypatch.setattr(process, "_read_supervisor_bootstrap", lambda: (_ for _ in ()).throw(ValueError("missing")))

    assert process.main([]) == 1


def test_main_returns_failure_for_invalid_config(monkeypatch) -> None:
    monkeypatch.delenv("GLIMMER_CRADLE_CONFIG", raising=False)
    monkeypatch.setattr(process, "_read_supervisor_bootstrap", lambda: {
        "kernelEndpoint": "grpc://127.0.0.1:1",
        "generation": "test-generation",
        "registrationNonce": "nonce",
        "registrationSecret": "AA",
    })

    assert process.main(
        [
            "--config-json",
            "not-json",
        ]
    ) == 1


def _reset_trace_state() -> None:
    process._boot_id = None
    process._synthetic_counters.clear()
    process._boot_synthetic_counter = 0
    process._span_id_var.set(None)
    process._trace_id_var.set(None)


def test_trace_processor_injects_boot_trace_and_span_without_session_terms() -> None:
    _reset_trace_state()
    process.set_boot_id("boot-1")
    process.set_current_span_id("span-1")
    with process.TraceContext("trace-1"):
        event = process.trace_context_processor(None, "info", {"event": "hi"})
    assert event["boot_id"] == "boot-1"
    assert event["trace_id"] == "trace-1"
    assert event["span_id"] == "span-1"
    assert "epoch_id" not in event and "session_id" not in event


def test_trace_processor_synthesizes_stable_process_scoped_ids() -> None:
    _reset_trace_state()
    process.set_boot_id("bootABC")
    first = process.trace_context_processor(
        None, "info", {"event": "x", "module": "app-root"}
    )
    second = process.trace_context_processor(
        None, "info", {"event": "y", "module": "memory"}
    )
    assert (first["trace_id"], second["trace_id"]) == (
        "run-bootABC-1", "run-bootABC-2"
    )

    _reset_trace_state()
    synthetic = process.trace_context_processor(
        None, "info", {"event": "x", "module": "app-root"}
    )
    assert synthetic["trace_id"] == "synthetic-app-root-1"


def test_trace_processor_preserves_explicit_trace_and_omits_absent_span() -> None:
    _reset_trace_state()
    process.set_boot_id("boot")
    with process.TraceContext("context"):
        event = process.trace_context_processor(
            None, "info", {"event": "x", "trace_id": "explicit"}
        )
    assert event["trace_id"] == "explicit"
    assert "span_id" not in event


async def test_metrics_write_jsonl_with_trace_and_sanitized_labels(
    tmp_path: Path,
) -> None:
    _reset_trace_state()
    process.set_boot_id("boot-m")
    await process.start_metrics(tmp_path, proc="test")
    try:
        with process.TraceContext("trace-m"):
            process.counter("calls", 1)
            process.gauge(
                "emotion.intensity", 0.7, labels={"emotion": "happy"}
            )
            process.histogram("chat.duration_ms", 123.4)
        await process.stop_metrics()
    finally:
        await process.stop_metrics()
        process._boot_id = None

    lines = [
        json.loads(line)
        for line in (tmp_path / "test.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    by_name = {line["name"]: line for line in lines}
    assert by_name["calls"]["kind"] == "counter"
    assert by_name["emotion.intensity"]["labels"] == {"emotion": "happy"}
    assert by_name["chat.duration_ms"]["value"] == 123.4
    assert all(line["trace_id"] == "trace-m" for line in lines)
    assert all(line["boot_id"] == "boot-m" for line in lines)

    assert process.sanitize_metric_labels("reasoning.request", {
        "tier": "cloud_allowed",
        "trace_id": "trace-1",
        "prompt_hash": "hash-1",
    }) == {"tier": "cloud_allowed"}


def test_metrics_are_noop_before_start() -> None:
    process.gauge("never.started", 1.0)
    process.counter("never.started.count")


async def test_tracer_writes_attributes_error_and_remote_parent(
    tmp_path: Path,
) -> None:
    _reset_trace_state()
    process.set_boot_id("boot-x")
    await process.start_tracer(tmp_path, proc="trace")
    try:
        with process.TraceContext("trace-1"):
            with process.span("ok", attributes={"key": "value"}) as current:
                current.set_attribute("extra", 42)
            try:
                with process.span("boom"):
                    raise ValueError("explode")
            except ValueError:
                pass
        with process.with_remote_parent_span("remote-trace", "remote-span"), process.span("remote-child"):
            pass
        await process.stop_tracer()
    finally:
        await process.stop_tracer()
        process._boot_id = None

    records = [
        json.loads(line)
        for line in (tmp_path / "trace.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    by_name = {record["name"]: record for record in records}
    assert by_name["ok"]["attributes"] == {"key": "value", "extra": 42}
    assert by_name["ok"]["boot_id"] == "boot-x"
    assert by_name["ok"]["status"] == "ok"
    assert by_name["ok"]["duration_ms"] >= 0
    assert by_name["boom"]["status"] == "error"
    assert by_name["boom"]["error"] == "ValueError"
    assert by_name["remote-child"]["trace_id"] == "remote-trace"
    assert by_name["remote-child"]["parent_span_id"] == "remote-span"


async def test_nested_spans_record_parent_and_restore_context(tmp_path: Path) -> None:
    _reset_trace_state()
    await process.start_tracer(tmp_path, proc="nested")
    try:
        with process.TraceContext("trace"):
            with process.span("outer") as outer:
                with process.span("inner") as inner:
                    assert process.get_current_span_id() == inner.span_id
                assert process.get_current_span_id() == outer.span_id
            assert process.get_current_span_id() is None
        await process.stop_tracer()
    finally:
        await process.stop_tracer()

    records = [
        json.loads(line)
        for line in (tmp_path / "nested.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    by_name = {record["name"]: record for record in records}
    assert by_name["inner"]["parent_span_id"] == by_name["outer"]["span_id"]
    assert by_name["outer"]["parent_span_id"] is None


def test_span_is_safe_noop_before_tracer_start() -> None:
    _reset_trace_state()
    with process.span("not-started"):
        pass


class _LoggerCapture:
    def __init__(self) -> None:
        self.messages: list[str] = []

    def _record(self, event: str, values: dict) -> None:
        self.messages.append(event + json.dumps(values, ensure_ascii=False, default=str))

    def info(self, event: str, **values) -> None:
        self._record(event, values)

    def debug(self, event: str, **values) -> None:
        self._record(event, values)

    def warning(self, event: str, **values) -> None:
        self._record(event, values)


def _build_llm_engine(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    *,
    capture_mode: str,
) -> LLMEngine:
    monkeypatch.setenv("GLIMMER_CRADLE_OBSERVABILITY", json.dumps({
        "model_invocations": {
            "capture_mode": capture_mode,
            "redact_secrets": True,
            "full_retention_days": 3,
        }
    }))
    monkeypatch.setenv("GLIMMER_CRADLE_OBSERVABILITY_DIR", str(tmp_path))
    return LLMEngine(
        ModelSettings(
            max_tokens=1024, temperature=0.8, top_p=0.9, frequency_penalty=0.0
        ),
        LLMSettings(
            api_type="openai",
            api_key="sk-top-secret",
            base_url="https://example.com",
            models={"chat": "test-model"},
        ),
        logger=_LoggerCapture(),
        invocation_recorder=process.record_model_invocation,
    )


def test_model_invocation_summary_records_hash_without_prompt(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    engine = _build_llm_engine(monkeypatch, tmp_path, capture_mode="summary")
    monkeypatch.setattr(
        engine,
        "_generate_via_api",
        lambda _request, _config, provider_id: LLMApiResult(
            text="provider reply",
            payload={"messages": [{"role": "user", "content": "secret prompt"}]},
            response_data={"choices": [{"message": {"content": "provider reply"}}]},
            provider_id=provider_id,
            model_id="test-model",
        ),
    )
    reply = engine.generate(ModelRequest(
        messages=[
            ModelMessage(role="system", content="system prompt"),
            ModelMessage(role="user", content="secret prompt"),
        ],
        metadata={
            "purpose": "reply", "capture_category": "response",
            "scene_id": "scene-1", "trace_id": "trace-1",
        },
    ))
    assert reply == "provider reply"

    row = json.loads(
        (tmp_path / "model-invocations" / "records" / "cognition.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()[0]
    )
    assert row["capture_mode"] == "summary"
    assert row["schema_version"] == "2.0.0"
    assert row["prompt_hash"]
    assert row["prompt_text_ref"] is None
    assert row["provider_payload_ref"] is None
    assert "secret prompt" not in json.dumps(row, ensure_ascii=False)
    assert all("secret prompt" not in message for message in engine._logger.messages)


def test_model_invocation_full_capture_is_ordered_and_redacted(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    engine = _build_llm_engine(monkeypatch, tmp_path, capture_mode="full")
    monkeypatch.setattr(
        engine,
        "_generate_via_api",
        lambda _request, _config, provider_id: LLMApiResult(
            text="full reply",
            payload={
                "headers": {"Authorization": "Bearer sk-top-secret"},
                "messages": [{"role": "user", "content": "full prompt"}],
            },
            response_data={"choices": [{"message": {"content": "full reply"}}]},
            provider_id=provider_id,
            model_id="test-model",
        ),
    )
    for purpose, category, prompt in (
        ("cognitive_action_plan", "decision", "full prompt"),
        ("agent_plan", "skill", "plan a skill"),
        ("reply", "response", "second prompt"),
    ):
        engine.generate(ModelRequest(
            messages=[ModelMessage(role="user", content=prompt)],
            metadata={
                "purpose": purpose,
                "capture_category": category,
                "trace_id": "trace-full",
            },
        ))

    invocation_root = tmp_path / "model-invocations"
    rows = [
        json.loads(line)
        for line in (invocation_root / "records" / "cognition.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert "/trace-trace-full/01-action-decision/001_" in rows[0]["prompt_text_ref"]
    assert "/trace-trace-full/02-skill-planning/002_" in rows[1]["prompt_text_ref"]
    assert "/trace-trace-full/03-final-response/003_" in rows[2]["prompt_text_ref"]
    invocation_dir = (invocation_root / rows[0]["prompt_text_ref"]).parent
    payload = (invocation_root / rows[0]["provider_payload_ref"]).read_text(
        encoding="utf-8"
    )
    assert "sk-top-secret" not in payload
    assert "[REDACTED]" in payload or "[REDACTED_API_KEY]" in payload
    manifest = json.loads(
        (invocation_dir / "00-manifest.json").read_text(encoding="utf-8")
    )
    assert manifest["sequence"] == 1
    assert manifest["files"]["prompt"] == "10-prompt.txt"
    timeline = (invocation_dir.parent.parent / "timeline.md").read_text(
        encoding="utf-8"
    )
    assert timeline.index("cognitive_action_plan") < timeline.index("agent_plan")
    assert timeline.index("agent_plan") < timeline.index("reply")


def test_model_invocation_redacts_provider_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    engine = _build_llm_engine(monkeypatch, tmp_path, capture_mode="summary")

    def raise_provider_error(*_args):
        raise llm_module.InferenceException(
            "LLM API 请求失败: 401, Bearer sk-top-secret"
        )

    monkeypatch.setattr(engine, "_generate_via_api", raise_provider_error)
    with pytest.raises(llm_module.InferenceException, match="401"):
        engine.generate(ModelRequest(
            messages=[ModelMessage(role="user", content="hello")],
            metadata={"purpose": "reply"},
        ))

    row = json.loads(
        (tmp_path / "model-invocations" / "records" / "cognition.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()[0]
    )
    assert row["outcome"] == "failed"
    assert row["capture_category"] == "other"
    assert "sk-top-secret" not in (row["error_summary"] or "")
    assert "Bearer [REDACTED]" in (row["error_summary"] or "")


def test_production_composition_injects_reachable_logger_sink(
    monkeypatch,
    tmp_path: Path,
) -> None:
    records: list[tuple[str, str, dict]] = []

    class _RecordingLogger:
        def __init__(self, name: str) -> None:
            self.name = name

        def _record(self, level: str, event: str, values: dict) -> None:
            records.append((level, f"{self.name}:{event}", values))

        def debug(self, event: str, **values) -> None: self._record("debug", event, values)
        def info(self, event: str, **values) -> None: self._record("info", event, values)
        def warning(self, event: str, **values) -> None: self._record("warning", event, values)
        def error(self, event: str, **values) -> None: self._record("error", event, values)
        def critical(self, event: str, **values) -> None: self._record("critical", event, values)

    monkeypatch.setattr(process, "get_logger", lambda name: _RecordingLogger(name))
    monkeypatch.setenv("GLIMMER_CRADLE_DATA_ROOT", str(tmp_path / "data"))
    monkeypatch.setenv(
        "GLIMMER_CRADLE_OBSERVABILITY_DIR", str(tmp_path / "observability")
    )

    async def action_sink(_command) -> None:
        return None

    components = compose_cognition(
        map_character_runtime_document(normalized_document()),
        action_sink=action_sink,
        observability=process.FileObservability(),
    )
    components.cycle_controller.logger.info(
        "production-sink-probe", marker="reachable"
    )
    assert any(
        event.endswith(":production-sink-probe")
        and values.get("marker") == "reachable"
        for _, event, values in records
    )


@pytest.mark.asyncio
async def test_registration_secret_is_zeroed_on_client_registration_failure() -> None:
    secret = bytearray(b"registration-capability")
    client = KernelGrpcClient("generation-1", "nonce", secret)

    async def reject_registration(*_args, **_kwargs):
        raise RuntimeError("registration rejected")

    client._call = reject_registration  # type: ignore[method-assign]
    try:
        with pytest.raises(RuntimeError, match="registration rejected"):
            await client.start("grpc://127.0.0.1:1", "grpc://127.0.0.1:2")
        assert secret == bytearray(len(secret))
        assert client._registration_nonce == ""
    finally:
        await client.stop()
