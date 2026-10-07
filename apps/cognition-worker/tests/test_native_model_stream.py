"""本地真实 HTTP/SSE；不调用付费 provider，不读取用户 secret。"""

import asyncio
import json
from contextlib import asynccontextmanager

import pytest
from glimmer_cradle.cognition.inference import (
    InferenceRequest,
    InferenceStep,
    ModelEventKind,
    ModelSettings,
    ModelToolCall,
)
from glimmer_cradle.cognition.ports import (
    LOAD_SKILL,
    READ_RESOURCE,
    CapabilityDescriptor,
    CapabilityResult,
    ResourceDescriptor,
    SkillReference,
    SkillSummary,
)
from glimmer_cradle.cognition_worker.adapters.model_client import (
    InferenceException,
    LLMEngine,
    LLMSettings,
    ModelClient,
)


def frame(delta, finish=None):
    return ("data: " + json.dumps({"choices": [{"index": 0, "delta": delta,
        "finish_reason": finish}]}, ensure_ascii=False) + "\r\n\r\n").encode()


def tool(index=0, call_id="call-weather", name="tool_weather", arguments='{"city":"上海"}'):
    return {"index": index, "id": call_id, "type": "function",
        "function": {"name": name, "arguments": arguments}}


@asynccontextmanager
async def provider(body, *, split=False, stall=False):
    requests = []
    entered, disconnected = asyncio.Event(), asyncio.Event()
    writers = set()
    tasks = set()

    async def handle(reader, writer):
        tasks.add(asyncio.current_task())
        writers.add(writer)
        try:
            header = (await reader.readuntil(b"\r\n\r\n")).decode()
            size = next(int(line.split(":", 1)[1]) for line in header.split("\r\n")
                if line.lower().startswith("content-length:"))
            requests.append(json.loads(await reader.readexactly(size)))
            entered.set()
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n")
            if split:
                for byte in body:
                    writer.write(bytes([byte]))
                    await writer.drain()
                    await asyncio.sleep(0)
            else:
                writer.write(body)
                await writer.drain()
            if stall:
                assert await reader.read() == b""
                disconnected.set()
        finally:
            writer.close()
            await writer.wait_closed()
            writers.discard(writer)
            tasks.discard(asyncio.current_task())

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    try:
        yield f"http://127.0.0.1:{server.sockets[0].getsockname()[1]}", requests, entered, disconnected
    finally:
        server.close()
        await server.wait_closed()
        for writer in tuple(writers):
            writer.close()
        if tasks:
            await asyncio.gather(*tuple(tasks), return_exceptions=True)


def engine(endpoint, captures=None, **settings):
    return LLMEngine(ModelSettings(max_tokens=100, temperature=0.5, top_p=0.9, frequency_penalty=0.0),
        LLMSettings(api_type="openai", api_key="test-only-key", base_url=endpoint,
            models={"chat": "test-model"}, **settings),
        invocation_recorder=(lambda **value: captures.append(value)) if captures is not None else None)


async def test_real_sse_aggregates_interleaved_arguments_and_preserves_native_history():
    body = b": keepalive\r\n\r\n" + frame({"content": "查询中。", "tool_calls": [
        tool(arguments='{"city":'), tool(1, "call-other", "tool_other", '{"q":')]})
    body += frame({"tool_calls": [{"index": 1, "function": {"arguments": '"北京"}'}},
        {"index": 0, "function": {"arguments": '"上海"}'}}]}, "tool_calls") + b"data: [DONE]\r\n\r\n"
    captures = []
    async with provider(body, split=True) as (endpoint, requests, _, _):
        client = ModelClient(engine(endpoint, captures))
        request = InferenceRequest(system="角色", user="天气", max_tokens=80,
            metadata={"run_id": "run", "step": 2, "capabilities": (
                CapabilityDescriptor("tool_weather", "天气", "weather", "1", {}),),
                "capability_results": (CapabilityResult("ignored", "ignored", "succeeded", "not history"),)},
            history=(InferenceStep("先查。", (ModelToolCall("previous", "tool_weather", {"city": "上海"}),),
                (CapabilityResult("previous", "tool_weather", "failed", error="denied"),)),),
            vision=(("图片", "data:image/png;base64,cG5n", "image/png"),))
        events = [event async for event in client.events(request)]
        assert [event.sequence for event in events] == list(range(4))
        assert [event.kind for event in events] == [ModelEventKind.TEXT_DELTA,
            ModelEventKind.TOOL_CALL, ModelEventKind.TOOL_CALL, ModelEventKind.COMPLETED]
        assert events[1].payload == {"call_id": "call-weather", "name": "tool_weather", "arguments": {"city": "上海"}}
        assert events[2].payload["arguments"] == {"q": "北京"}
        payload = requests[0]
        assert payload["stream"] is True and payload["max_tokens"] == 80
        assert payload["tools"][0]["function"]["name"] == "tool_weather"
        assert payload["tools"][0]["function"]["parameters"] == {"type": "object"}
        assert payload["messages"][1]["content"][0]["type"] == "image_url"
        assert payload["messages"][-2]["role"] == "assistant"
        assert payload["messages"][-2]["tool_calls"][0]["id"] == "previous"
        assert payload["messages"][-1] == {"role": "tool", "tool_call_id": "previous",
            "content": '{"status": "failed", "output": null, "error": "denied"}'}
        assert "ignored" not in json.dumps(payload)
        assert captures[0]["outcome"] == "succeeded" and captures[0]["attributes"]["tool_calls"] == 2
        assert client._sessions == {}


@pytest.mark.parametrize("remaining", [0, 2])
async def test_native_loading_controls_select_independent_catalogs(remaining):
    body = frame({"tool_calls": [tool(name=LOAD_SKILL, arguments='{"skill_id":"method","arguments":{"topic":"上海"}}'),
        tool(1, "resource-call", READ_RESOURCE, '{"resource_id":"resource"}')]}, "tool_calls") + b"data: [DONE]\r\n\r\n"
    async with provider(body) as (endpoint, requests, _, _):
        events = [event async for event in ModelClient(engine(endpoint)).events(InferenceRequest("", "读取",
            metadata={"remaining_capability_calls": remaining, "skills": (SkillSummary(SkillReference("method", "m1"), "方法", "摘要"),),
                "resources": (ResourceDescriptor("资源", "摘要", "resource", "r1"),)}))]
        functions = [item["function"] for item in requests[0].get("tools", [])]
        assert [item["name"] for item in functions] == ([LOAD_SKILL, READ_RESOURCE] if remaining else [])
        assert events[0].payload.get("kind") == ("skill" if remaining else None)
        assert events[1].payload.get("kind") == ("resource" if remaining else None)
        if remaining:
            assert functions[0]["parameters"]["properties"]["skill_id"]["enum"] == ["method"]


@pytest.mark.parametrize("failure", ["length", "filter", "no_done", "no_finish", "invalid_json",
    "not_object", "nan", "duplicate_key", "duplicate_call", "invalid_index", "incomplete_frame", "arguments_limit"])
async def test_real_stream_fails_without_emitting_invokable_call(failure):
    arguments = {"invalid_json": '{"city":', "not_object": "[]", "nan": '{"x":NaN}',
        "duplicate_key": '{"x":1,"x":2}', "arguments_limit": '{"x":"' + "a" * 65536 + '"}'}
    calls = [tool(arguments=arguments.get(failure, "{}"))]
    if failure == "duplicate_call":
        calls.append(tool(1))
    if failure == "invalid_index":
        calls[0]["index"] = True
    finish = {"length": "length", "filter": "content_filter", "no_finish": None}.get(failure, "tool_calls")
    body = frame({"tool_calls": calls}, finish)
    if failure != "no_done":
        body += b"data: [DONE]\r\n\r\n"
    if failure == "incomplete_frame":
        body = body.removesuffix(b"\r\n\r\n")
    async with provider(body) as (endpoint, _, _, _):
        seen = []
        with pytest.raises(InferenceException):
            async for event in ModelClient(engine(endpoint)).events(InferenceRequest("", "test")):
                seen.append(event)
        assert not any(event.kind in {ModelEventKind.TOOL_CALL, ModelEventKind.COMPLETED} for event in seen)


@pytest.mark.parametrize("cancel", ["task", "session"])
async def test_native_stream_cancellation_disconnects_actual_http_socket(cancel):
    captures = []
    async with provider(b"", stall=True) as (endpoint, requests, entered, disconnected):
        client = ModelClient(engine(endpoint, captures))
        async def consume():
            return [event async for event in client.events(InferenceRequest("", "cancel", metadata={"run_id": "run"}))]
        pending = asyncio.create_task(consume())
        await asyncio.wait_for(entered.wait(), 3)
        if cancel == "task":
            pending.cancel()
        else:
            await client.cancel("run")
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(pending, 2)
        await asyncio.wait_for(disconnected.wait(), 2)
        assert len(requests) == 1 and client._sessions == {}
        assert captures[0]["outcome"] == "failed" and captures[0]["error_code"] == "cancelled"


async def test_native_stream_default_route_uses_configured_provider_and_model():
    body = frame({"content": "完成"}, "stop") + b"data: [DONE]\n\n"
    async with provider(body) as (endpoint, requests, _, _):
        configured = engine("https://example.invalid", default_route={"provider": "configured", "model_alias": "chat"},
            providers={"configured": {"api_type": "openai", "base_url": endpoint,
                "models": {"chat": "configured-model"}}})
        events = [event async for event in ModelClient(configured).events(InferenceRequest("", "test"))]
        assert requests[0]["model"] == "configured-model" and events[-1].kind == ModelEventKind.COMPLETED


async def test_loop_output_limit_closes_real_native_stream_before_done(tmp_path):
    from conftest import (
        DeterministicIds,
        FixedClock,
        NullObservability,
        build_test_recorder,
    )
    from glimmer_cradle.cognition.attention import AttentionController
    from glimmer_cradle.cognition.loop import LoopController, StopPolicy
    from glimmer_cradle.cognition.ports import CapabilityExposure

    class Capability:
        async def expose(self, **kwargs):
            return CapabilityExposure(kwargs["run_id"], kwargs["step"], ())
        async def invoke(self, _request):
            raise AssertionError("no invocation allowed")
    async with provider(frame({"content": "超过预算"}), stall=True) as (endpoint, _, _, disconnected):
        model = ModelClient(engine(endpoint))
        loop = LoopController(workspace=AttentionController(clock=FixedClock()), providers=[],
            experience_recorder=build_test_recorder(tmp_path), clock=FixedClock(), ids=DeterministicIds(),
            observability=NullObservability())
        run = await loop.run_native(InferenceRequest("", "test"), model=model, capabilities=Capability(),
            scope="conversation", stop_policy=StopPolicy(max_output_chars=2))
        assert run.stop_reason == "output_limit" and model._sessions == {}
        await asyncio.wait_for(disconnected.wait(), 2)
