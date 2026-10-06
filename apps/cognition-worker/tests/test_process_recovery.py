import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

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
from glimmer_cradle.cognition_worker.readiness import (
    WORKER_READY_COMPONENTS,
    ReadinessTracker,
)
from glimmer_cradle.cognition_worker.rpc_service import KernelGrpcClient


def test_main_returns_failure_for_missing_kernel_injection(monkeypatch) -> None:
    monkeypatch.delenv("GLIMMER_CRADLE_CONFIG", raising=False)
    monkeypatch.setattr(process, "_read_supervisor_bootstrap", lambda: (_ for _ in ()).throw(ValueError("missing")))

    assert process.main([]) == 1


def test_invalid_memory_jobs_owner_is_rejected_before_bootstrap_or_composition(monkeypatch, tmp_path):
    bootstrap = AsyncMock()
    monkeypatch.setattr(process, "_read_supervisor_bootstrap", bootstrap)
    with pytest.raises(SystemExit) as error:
        process.main(["--memory-jobs-owner", "typo"])
    assert error.value.code == 2
    bootstrap.assert_not_called()
    monkeypatch.setenv("GLIMMER_CRADLE_DATA_ROOT", str(tmp_path / "not-created"))
    with pytest.raises(ValueError, match="owner 无效"):
        compose_cognition(map_character_runtime_document(normalized_document()), action_sink=AsyncMock(),
                          observability=process.FileObservability(), memory_jobs_owner="typo")
    assert not (tmp_path / "not-created").exists()


@pytest.mark.parametrize("owner", ["legacy", "external"])
async def test_real_worker_composition_selects_only_one_memory_jobs_owner(monkeypatch, tmp_path, owner):
    import grpc
    from glimmer.cognition.v1 import cognition_service_pb2 as cognition_pb
    from glimmer.common.v1 import service_contract_pb2 as common_pb
    from glimmer_cradle.conversation import MomentKind

    monkeypatch.setenv("GLIMMER_CRADLE_DATA_ROOT", str(tmp_path / "data"))
    components = compose_cognition(map_character_runtime_document(normalized_document()), action_sink=AsyncMock(),
                                  observability=process.FileObservability(), memory_jobs_owner=owner)
    recorder, database, coordinator = components.conversation_recorder, components.cognition_database, components.consolidation_coordinator
    host = process.CognitionGrpcHost(generation="test", inbound=None, queue=None, activity=None, cycle=None,
                                    shutdown=AsyncMock(), operations=None, workspace=None, consolidation=coordinator)
    channel = None
    try:
        await recorder.start()
        await database.connect()
        await database.select_consolidation_dispatch(owner)
        await components.memory_substrate.load()
        await coordinator.start()
        assert coordinator.uses_external_jobs == (owner == "external")
        recorder.record(MomentKind.PERCEPTION, {"text": "装配事实"}, interaction_id="turn",
                        conversation_id="conversation", retention_ceiling="memory_candidate", importance=0.9)
        await recorder.flush()
        # 维护只发布源请求，不在外部模式调用生产模型或创建旧任务。
        if owner == "external":
            assert await coordinator.consolidate(force_seal=True) == 0
        await host.start(); host.mark_ready()
        channel = grpc.aio.insecure_channel(host.endpoint.removeprefix("grpc://"))
        metadata = common_pb.CallMetadata(trace_id="probe", generation="test")
        read = channel.unary_unary("/glimmer.cognition.v1.CognitionService/ReadMemoryJobRequests",
                                  request_serializer=cognition_pb.ReadMemoryJobRequestsRequest.SerializeToString,
                                  response_deserializer=cognition_pb.ReadMemoryJobRequestsResponse.FromString)
        request = cognition_pb.ReadMemoryJobRequestsRequest(call=metadata, limit=8)
        if owner == "external":
            sources = (await read(request, timeout=2)).requests
            assert len(sources) == 1
            async with database.read() as conn:
                assert await (await conn.execute("SELECT job_id FROM consolidation_jobs")).fetchall() == []
            await database.close(); await database.connect()
            with pytest.raises(ValueError, match="禁止恢复旧巩固队列"):
                await database.select_consolidation_dispatch("legacy")
        else:
            for method, request_type, response_type in [
                ("ReadMemoryJobRequests", cognition_pb.ReadMemoryJobRequestsRequest, cognition_pb.ReadMemoryJobRequestsResponse),
                ("AcknowledgeMemoryJobRequest", cognition_pb.AcknowledgeMemoryJobRequestRequest, cognition_pb.AcknowledgeMemoryJobRequestResponse),
                ("ExecuteMemoryJob", cognition_pb.ExecuteMemoryJobRequest, cognition_pb.ExecuteMemoryJobResponse),
                ("ReconcileMemoryJob", cognition_pb.ReconcileMemoryJobRequest, cognition_pb.ReconcileMemoryJobResponse),
            ]:
                call = channel.unary_unary(f"/glimmer.cognition.v1.CognitionService/{method}",
                                          request_serializer=request_type.SerializeToString, response_deserializer=response_type.FromString)
                with pytest.raises(grpc.aio.AioRpcError) as failure:
                    await call(request_type(call=metadata), timeout=2)
                assert failure.value.code() == grpc.StatusCode.FAILED_PRECONDITION
        async with database.read() as conn:
            assert await (await conn.execute("SELECT owner FROM memory_consolidation_dispatch")).fetchall() == [(owner,)]
    finally:
        if channel is not None: await channel.close()
        await host.stop()
        await coordinator.stop()
        await recorder.stop()
        await database.close()


@pytest.mark.parametrize("owner", ["legacy", "external"])
def test_cli_passes_memory_jobs_owner_to_production_host(monkeypatch, owner):
    monkeypatch.setattr(process, "_read_supervisor_bootstrap", lambda: {
        "kernelEndpoint": "grpc://127.0.0.1:1", "generation": "test", "registrationNonce": "nonce",
        "registrationSecret": "dGVzdA",
    })
    arguments = {}
    def host(**kwargs):
        arguments.update(kwargs)
        raise RuntimeError("constructor probe")
    monkeypatch.setattr(process, "CognitionHost", host)
    with pytest.raises(RuntimeError, match="constructor probe"):
        process.main(["--config-json", json.dumps(normalized_document()), "--memory-jobs-owner", owner])
    assert arguments["memory_jobs_owner"] == owner


async def test_real_production_startup_refuses_legacy_pending_before_maintenance_and_drains(monkeypatch, tmp_path):
    from glimmer_cradle.cognition.adapters.persistence import SqliteMemoryStore

    data_root = tmp_path / "data"
    monkeypatch.setenv("GLIMMER_CRADLE_DATA_ROOT", str(data_root))
    path = data_root / "state" / "cognition" / "memory.sqlite"
    seed = SqliteMemoryStore(path)
    await seed.connect(); await seed.select_consolidation_dispatch("legacy")
    async with seed.transaction() as conn:
        await conn.execute("INSERT INTO consolidation_jobs(job_id,episode_id,episode_version,scene_id,state,priority,"
                           "available_at,policy_version,created_at) VALUES('old','episode',1,'scene','claimed',1,'now','old','now')")
    await seed.close()
    client = SimpleNamespace(send_action_command=AsyncMock(), start=AsyncMock(), stop=AsyncMock())
    monkeypatch.setattr(process, "KernelGrpcClient", lambda *_args: client)
    for method in ("start_metrics", "start_tracer", "stop_metrics", "stop_tracer"):
        monkeypatch.setattr(process, method, AsyncMock())
    config = map_character_runtime_document(normalized_document())
    host = process.CognitionHost(config, "grpc://127.0.0.1:1", "test", "nonce", bytearray(b"test"), "external")
    try:
        with pytest.raises(ValueError, match="旧巩固队列未完成"):
            await host.start()
        assert host.readiness.state == "stopped" and not host.readiness.is_ready
        assert host.cognition_grpc_host is None
        assert host.components.cognition_database._conn is None
        client.start.assert_not_awaited()
        client.stop.assert_awaited_once()
        assert host.registration_secret is None
        # 启动失败保留原队列，不以恢复 expired 或模型执行代替数据迁移。
        await seed.connect()
        async with seed.read() as conn:
            assert await (await conn.execute("SELECT state FROM consolidation_jobs")).fetchall() == [("claimed",)]
            assert await (await conn.execute("SELECT owner FROM memory_consolidation_dispatch")).fetchall() == [("legacy",)]
        # 证明 Conversation 单写者已释放，后续正确 legacy 装配可取得同一数据根。
        following = compose_cognition(config, action_sink=AsyncMock(), observability=process.FileObservability())
        await following.conversation_recorder.start()
        await following.conversation_recorder.stop()
    finally:
        await host.stop(); await seed.close()


def test_readiness_requires_every_component_and_cannot_reopen_during_stop() -> None:
    readiness = ReadinessTracker(WORKER_READY_COMPONENTS)
    readiness.begin_startup()
    for component in WORKER_READY_COMPONENTS - {"initial_state_sync"}:
        readiness.mark_ready(component)
    assert not readiness.is_ready
    assert readiness.missing == frozenset({"initial_state_sync"})
    readiness.mark_degraded("loop", "checkpoint recovery failed")
    assert readiness.state == "degraded"
    readiness.mark_ready("initial_state_sync")
    assert not readiness.is_ready
    readiness.mark_ready("loop")
    assert readiness.state == "ready"
    readiness.begin_shutdown()
    assert readiness.state == "stopping" and not readiness.is_ready
    with pytest.raises(RuntimeError, match="停机"):
        readiness.mark_ready("loop")
    readiness.mark_stopped()
    assert readiness.state == "stopped"
    with pytest.raises(ValueError, match="unknown"):
        readiness.mark_ready("unregistered")


@pytest.mark.parametrize("projection_fails", [False, True])
@pytest.mark.parametrize("owner", ["legacy", "external"])
async def test_production_worker_waits_for_first_state_projection_before_ready(
    monkeypatch, projection_fails: bool, owner: str,
) -> None:
    import grpc
    from glimmer.cognition.v1 import cognition_service_pb2 as cognition_pb
    from glimmer.common.v1 import service_contract_pb2 as common_pb
    from glimmer_cradle.cognition_worker import composition

    projection_entered, projection_release = asyncio.Event(), asyncio.Event()

    async def nothing(*_args) -> None:
        pass

    def component():
        return SimpleNamespace(connect=nothing, start=nothing, stop=nothing, close=nothing, select_consolidation_dispatch=nothing,
                               load=nothing, load_persisted=nothing)

    components = SimpleNamespace(
        conversation_recorder=component(), state_store=component(), planning_store=component(),
        knowledge_store=component(), checkpoint_store=component(), cognition_database=component(),
        turn_controller=component(), conversation_controller=component(), memory_substrate=component(),
        knowledge_base=component(), maintenance_scheduler=component(),
        consolidation_coordinator=component(),
        activity_controller=SimpleNamespace(start=nothing, stop=nothing, on_transition=lambda _f: None),
        cycle_controller=component(), inbound_adapter=None, observation_queue=None,
        perception_operations=None, workspace=None,
        character_session=SimpleNamespace(wake_up=lambda: None, sleep=lambda: None,
                                          get_state=lambda: {"name": "test", "is_awake": True}),
    )
    compose_arguments = {}
    def factory(*_args, **kwargs):
        compose_arguments.update(kwargs)
        return components
    selected = []
    async def select(value): selected.append(value)
    async def start_maintenance(): assert selected == [owner]
    components.cognition_database.select_consolidation_dispatch = select
    components.maintenance_scheduler.start = start_maintenance
    monkeypatch.setattr(composition, "compose_cognition", factory)
    for method in ("start_metrics", "start_tracer", "stop_metrics", "stop_tracer"):
        monkeypatch.setattr(process, method, nothing)

    class KernelClient:
        def __init__(self, *_args) -> None:
            pass

        start = stop = nothing
        send_action_command = nothing

        async def send_state_sync(self, _state) -> None:
            projection_entered.set()
            await projection_release.wait()
            if projection_fails:
                raise RuntimeError("injected initial projection failure")

    monkeypatch.setattr(process, "KernelGrpcClient", KernelClient)
    host = process.CognitionHost(
        config=SimpleNamespace(manifest=SimpleNamespace(base=SimpleNamespace(name="test"))),
        kernel_endpoint="grpc://127.0.0.1:1", generation="test", registration_nonce="test",
        registration_secret=bytearray(b"test"),
        memory_jobs_owner=owner,
    )
    startup = asyncio.create_task(host.start())
    channel = None
    try:
        await asyncio.wait_for(projection_entered.wait(), timeout=1)
        assert compose_arguments["memory_jobs_owner"] == owner
        assert selected == [owner]
        assert host.cognition_grpc_host._consolidation is components.consolidation_coordinator
        channel = grpc.aio.insecure_channel(host.cognition_grpc_host.endpoint.removeprefix("grpc://"))
        readiness = channel.unary_unary(
            "/glimmer.cognition.v1.CognitionService/GetReadiness",
            request_serializer=cognition_pb.GetReadinessRequest.SerializeToString,
            response_deserializer=cognition_pb.GetReadinessResponse.FromString,
        )
        request = cognition_pb.GetReadinessRequest(call=common_pb.CallMetadata(
            trace_id="readiness-test", generation="test"))
        before = await readiness(request, timeout=1)
        assert (before.state, before.phase) == ("starting", "domain_starting")
        assert host.readiness.missing == frozenset({"initial_state_sync"})
        submit = channel.unary_unary(
            "/glimmer.cognition.v1.CognitionService/SubmitPerception",
            request_serializer=cognition_pb.SubmitPerceptionRequest.SerializeToString,
            response_deserializer=cognition_pb.SubmitPerceptionResponse.FromString,
        )
        with pytest.raises(grpc.aio.AioRpcError) as rejected:
            await submit(cognition_pb.SubmitPerceptionRequest(call=common_pb.CallMetadata(
                trace_id="early-input", generation="test")), timeout=1)
        assert rejected.value.code() == grpc.StatusCode.FAILED_PRECONDITION
        projection_release.set()
        if projection_fails:
            with pytest.raises(RuntimeError, match="initial projection failure"):
                await asyncio.wait_for(startup, timeout=3)
            assert host.readiness.state == "stopped"
            assert host.cognition_grpc_host is None and host.kernel_client is None
        else:
            await asyncio.wait_for(startup, timeout=1)
            after = await readiness(request, timeout=1)
            assert (after.state, after.phase, after.generation) == ("ready", "ready", "test")
    finally:
        projection_release.set()
        await asyncio.wait_for(asyncio.gather(startup, return_exceptions=True), timeout=3)
        if channel is not None:
            await channel.close()
        await host.stop()
        process._boot_id = None


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


async def test_model_invocation_summary_records_hash_without_prompt(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    engine = _build_llm_engine(monkeypatch, tmp_path, capture_mode="summary")
    monkeypatch.setattr(
        engine,
        "_generate_via_api",
        AsyncMock(side_effect=lambda _request, _config, provider_id: LLMApiResult(
            text="provider reply",
            payload={"messages": [{"role": "user", "content": "secret prompt"}]},
            response_data={"choices": [{"message": {"content": "provider reply"}}]},
            provider_id=provider_id,
            model_id="test-model",
        )),
    )
    reply = await engine.generate(ModelRequest(
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


async def test_model_invocation_full_capture_is_ordered_and_redacted(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    engine = _build_llm_engine(monkeypatch, tmp_path, capture_mode="full")
    monkeypatch.setattr(
        engine,
        "_generate_via_api",
        AsyncMock(side_effect=lambda _request, _config, provider_id: LLMApiResult(
            text="full reply",
            payload={
                "headers": {"Authorization": "Bearer sk-top-secret"},
                "messages": [{"role": "user", "content": "full prompt"}],
            },
            response_data={"choices": [{"message": {"content": "full reply"}}]},
            provider_id=provider_id,
            model_id="test-model",
        )),
    )
    for purpose, category, prompt in (
        ("cognitive_action_plan", "decision", "full prompt"),
        ("agent_plan", "skill", "plan a skill"),
        ("reply", "response", "second prompt"),
    ):
        await engine.generate(ModelRequest(
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


async def test_model_invocation_redacts_provider_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    engine = _build_llm_engine(monkeypatch, tmp_path, capture_mode="summary")

    async def raise_provider_error(*_args):
        raise llm_module.InferenceException(
            "LLM API 请求失败: 401, Bearer sk-top-secret"
        )

    monkeypatch.setattr(engine, "_generate_via_api", raise_provider_error)
    with pytest.raises(llm_module.InferenceException, match="401"):
        await engine.generate(ModelRequest(
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
