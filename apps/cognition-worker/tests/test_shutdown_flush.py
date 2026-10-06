import asyncio
from types import SimpleNamespace

import pytest
from glimmer_cradle.cognition.inference import (
    InferenceRequest,
    ModelMessage,
    ModelRequest,
    ModelSettings,
)
from glimmer_cradle.cognition_worker import rpc_service as process
from glimmer_cradle.cognition_worker.adapters.model_client import (
    CloudReasoning,
    DashScopeEmbeddingSettings,
    LLMEngine,
    LLMSettings,
    MultimodalRouter,
    _DashScopeEmbeddingProvider,
)
from glimmer_cradle.cognition_worker.shutdown import ShutdownCoordinator


def test_provider_wire_logging_does_not_expose_request_urls() -> None:
    import logging

    assert not logging.getLogger("httpx").isEnabledFor(logging.INFO)
    assert not logging.getLogger("httpcore").isEnabledFor(logging.DEBUG)


async def test_shutdown_runs_every_step_once_and_reports_failures() -> None:
    calls: list[str] = []

    async def first() -> None:
        calls.append("first")
        raise RuntimeError("flush failed")

    async def second() -> None:
        calls.append("second")

    coordinator = ShutdownCoordinator(("flush", first), ("close", second))
    failures = await coordinator.run()
    repeated = await coordinator.run()

    assert calls == ["first", "second"]
    assert failures == repeated
    assert failures[0][0] == "flush"


async def test_shutdown_continues_after_one_waiter_is_cancelled() -> None:
    entered, release = asyncio.Event(), asyncio.Event()
    calls: list[str] = []

    async def flush() -> None:
        calls.append("flush")
        entered.set()
        await release.wait()

    async def close() -> None:
        calls.append("close")

    coordinator = ShutdownCoordinator(("flush", flush), ("close", close))
    cancelled = asyncio.create_task(coordinator.run())
    await asyncio.wait_for(entered.wait(), timeout=1)
    remaining = asyncio.create_task(coordinator.run())
    cancelled.cancel()
    with pytest.raises(asyncio.CancelledError):
        await cancelled
    release.set()
    assert await asyncio.wait_for(remaining, timeout=1) == ()
    assert await coordinator.run() == ()
    assert calls == ["flush", "close"]


@pytest.mark.parametrize("partial", [False, True])
async def test_production_host_uses_ordered_shutdown_and_closes_partial_startup(
    monkeypatch,
    partial: bool,
) -> None:
    calls: list[str] = []

    def component(name: str, *, fail: bool = False):
        async def shutdown() -> None:
            calls.append(name)
            if fail:
                raise RuntimeError("injected close failure")

        return SimpleNamespace(stop=shutdown, close=shutdown)

    kernel = component("kernel_client")
    metrics, tracer = component("metrics"), component("tracer")
    monkeypatch.setattr(process, "stop_metrics", metrics.stop)
    monkeypatch.setattr(process, "stop_tracer", tracer.stop)
    host = process.CognitionHost(
        config=SimpleNamespace(
            manifest=SimpleNamespace(base=SimpleNamespace(name="test"))
        ),
        kernel_endpoint="grpc://127.0.0.1:1",
        generation="test",
        registration_nonce="test",
        registration_secret=bytearray(b"test"),
    )
    host.kernel_client = kernel
    host.cognition_grpc_host = component("rpc_service")
    if not partial:
        host.components = SimpleNamespace(
            cycle_controller=component("loop"),
            character_session=SimpleNamespace(sleep=lambda: calls.append("character")),
            activity_controller=component("activity"),
            maintenance_scheduler=component("maintenance"),
            conversation_controller=component("history", fail=True),
            turn_controller=component("turns"),
            conversation_recorder=component("log"),
            cognition_database=component("memory"),
            checkpoint_store=component("checkpoint"),
            knowledge_store=component("knowledge"),
            planning_store=component("planning"),
            state_store=component("state"),
        )

    async def failed_main() -> None:
        raise RuntimeError("injected main loop failure")

    host._main_task = asyncio.create_task(failed_main())
    await asyncio.sleep(0)
    await asyncio.gather(host.stop(), host.stop())
    await host.stop()
    domain = (
        []
        if partial
        else [
            "loop",
            "character",
            "activity",
            "maintenance",
            "history",
            "turns",
            "log",
            "memory",
            "checkpoint",
            "knowledge",
            "planning",
            "state",
        ]
    )
    assert calls == ["rpc_service", *domain, "kernel_client", "metrics", "tracer"]
    assert host.readiness.state == "stopped"
    assert host.kernel_client is None and host.cognition_grpc_host is None
    failures = await host._shutdown_coordinator.run()
    assert [name for name, _error in failures] == (
        ["main_loop"] if partial else ["main_loop", "conversation_history"]
    )


@pytest.mark.parametrize("entry", ["cloud", "vision", "embedding"])
async def test_provider_cancellation_closes_real_http_connection(entry: str) -> None:
    entered, disconnected = asyncio.Event(), asyncio.Event()
    requests: list[dict] = []
    captures: list[dict] = []

    async def slow_provider(reader, writer) -> None:
        try:
            header = (await reader.readuntil(b"\r\n\r\n")).decode("ascii")
            size = next(int(line.split(":", 1)[1]) for line in header.split("\r\n")
                        if line.lower().startswith("content-length:"))
            import json
            requests.append(json.loads(await reader.readexactly(size)))
            entered.set()
            # 不返回响应，真实取消必须关闭 socket，而非只取消线程的等待者。
            assert await reader.read() == b""
        finally:
            writer.close()
            await writer.wait_closed()
            disconnected.set()

    server = await asyncio.start_server(slow_provider, "127.0.0.1", 0)
    endpoint = f"http://127.0.0.1:{server.sockets[0].getsockname()[1]}"
    engine = LLMEngine(
        ModelSettings(max_tokens=100, temperature=0.5, top_p=0.9, frequency_penalty=0.0),
        LLMSettings(api_type="openai", api_key="test-only-key", base_url=endpoint,
                    models={"chat": "test-model"}),
        invocation_recorder=lambda **record: captures.append(record),
    )
    if entry == "embedding":
        provider = _DashScopeEmbeddingProvider(DashScopeEmbeddingSettings(
            endpoint=endpoint, model="test-model", dimensions=64,
            request_timeout_ms=30_000, max_retries=3,
        ), api_key="test-only-key")
        request = provider.encode(["cancel"], text_type="document")
    elif entry == "vision":
        router = MultimodalRouter(SimpleNamespace(multimodal=SimpleNamespace(
            enabled=True, strategy="specialist_then_core", max_items=6,
            core_model="", image_model="", video_model="",
        )))
        router.set_llm_engine(engine)
        request = router.route({"items": [{"modality": "image", "uri": "data:image/png;base64,cG5n"}]})
    else:
        request = CloudReasoning(engine).generate(InferenceRequest(system="test", user="cancel"))
    pending = asyncio.create_task(request)
    try:
        await asyncio.wait_for(entered.wait(), timeout=3)
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(pending, timeout=1)
        await asyncio.wait_for(disconnected.wait(), timeout=1)
        assert len(requests) == 1
        if entry != "embedding":
            assert captures[0]["error_code"] == "cancelled"
            assert captures[0]["error_summary"] == "模型请求已取消"
            assert captures[0]["normalized_text"] == ""
    finally:
        pending.cancel()
        await asyncio.gather(pending, return_exceptions=True)
        server.close()
        await server.wait_closed()


async def test_model_http_payload_response_and_safe_errors(monkeypatch) -> None:
    import json

    import httpx
    from glimmer_cradle.cognition_worker.adapters import model_client

    requests = []
    status = 200

    def respond(request):
        requests.append(request)
        if status == 200:
            return httpx.Response(200, json={"choices": [{"message": {"content": " reply "}}]})
        return httpx.Response(status, text="private body Bearer test-only-key")

    original_client = httpx.AsyncClient
    monkeypatch.setattr(model_client.httpx, "AsyncClient", lambda **kwargs: original_client(
        transport=httpx.MockTransport(respond), **kwargs))
    engine = LLMEngine(
        ModelSettings(max_tokens=100, temperature=0.5, top_p=0.9, frequency_penalty=0.0),
        LLMSettings(api_type="openai", api_key="test-only-key", base_url="https://example.invalid",
                    models={"chat": "test-model"}),
    )
    request = ModelRequest(messages=[ModelMessage(role="user", content="test",
                                               vision_url="data:image/png;base64,cG5n")])
    assert await engine.generate(request) == "reply"
    payload = json.loads(requests[0].content)
    assert payload["model"] == "test-model"
    assert [part["type"] for part in payload["messages"][0]["content"]] == ["image_url", "text"]
    assert requests[0].headers["Authorization"] == "Bearer test-only-key"
    status = 401
    with pytest.raises(model_client.InferenceException, match="HTTP 401") as failure:
        await engine.generate(request)
    assert "private body" not in str(failure.value) and "test-only-key" not in str(failure.value)
    embedding = _DashScopeEmbeddingProvider(DashScopeEmbeddingSettings(
        endpoint="https://example.invalid?credential=test-only-key", model="test-model", dimensions=64,
        request_timeout_ms=1_000, max_retries=0,
    ), api_key="test-only-key")
    with pytest.raises(RuntimeError, match="HTTPStatusError") as embedding_failure:
        await embedding.encode(["test"], text_type="document")
    assert embedding_failure.value.__suppress_context__
    assert "test-only-key" not in str(embedding_failure.value)
