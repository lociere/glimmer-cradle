"""真实 typed gRPC 与真实 Conversation Log 的 native Tool 因果链。"""

import hashlib
import json

import grpc
import pytest
from conftest import build_test_recorder
from glimmer.capabilities.v1 import capabilities_pb2 as pb
from glimmer_cradle.cognition.ports import CapabilityInvocation
from glimmer_cradle.cognition_worker.adapters import CapabilityClient
from glimmer_cradle.cognition_worker.rpc_service import KernelGrpcClient
from glimmer_cradle.conversation import ExecutionResultFact, MomentKind
from google.protobuf.json_format import ParseDict


@pytest.mark.parametrize(
    "failure", ["none", "failed", "missing_receipt", "wrong_identity", "wrong_state", "unexposed"]
)
async def test_native_typed_rpc_requires_original_action_and_durable_result(
    tmp_path, failure
):
    recorder = build_test_recorder(tmp_path)
    await recorder.start()
    dispatched = []
    context = {
        "conversation_id": "conversation",
        "source_provider_id": "provider",
        "scene_id": "scene",
        "thread_id": "main",
        "interaction_id": "interaction",
        "continuity_id": "continuity",
        "recall_scope": "conversation_private",
        "disclosure_scope": "conversation_private",
        "actor_id": "external-actor",
    }

    async def expose(request, _context):
        assert (
            request.call.generation == "generation-1"
            and request.call.trace_id == "trace"
        )
        assert not request.scope.HasField("user_id")  # 外部 Actor 不是平台 User。
        result = pb.ExposeStepResponse(
            run_id=request.run_id, step=request.step, used_definition_bytes=123
        )
        tool = result.tools.add(
            name="tool_weather",
            reference=pb.CapabilityReference(
                id='["weather","lookup"]', revision="revision"
            ),
        )
        ParseDict({"type": "object"}, tool.input_schema)
        result.skills.add(
            name="方法",
            reference=pb.SkillReference(skill_id="method", definition_revision="1"),
        )
        return result

    async def invoke(request, _context):
        dispatched.append(request)
        source = next(
            (
                moment
                for moment in recorder.iter_moments_since(None)
                if moment.moment_id == request.source_fact_id
            ),
            None,
        )
        assert source is not None and source.kind == MomentKind.ACTION
        assert source.content["definition_revision"] == "revision"
        assert source.continuity_id == "continuity"
        assert request.call.idempotency_key == "run:call"
        event_id = hashlib.sha256(
            json.dumps(["run:call", 4], separators=(",", ":")).encode()
        ).hexdigest()
        if failure != "missing_receipt":
            await recorder.accept_execution_result(
                ExecutionResultFact(
                    event_id=event_id,
                    invocation_id="run:call",
                    revision=4,
                    attempt=0 if failure == "failed" else 1,
                    scope_id="conversation",
                    conversation_id="conversation",
                    source_fact_id=request.source_fact_id,
                    executor_id="weather",
                    capability_id="weather.lookup",
                    definition_revision="revision",
                    request_digest="a" * 64,
                    state="failed" if failure == "failed" else "succeeded",
                    side_effects="none" if failure == "failed" else "confirmed",
                    result=None if failure == "failed" else {"actual": "晴"},
                    error_code="authorization_denied" if failure == "failed" else "",
                    updated_at_ms=1,
                )
            )
        response = pb.InvokeToolResponse(
            call_id="wrong" if failure == "wrong_identity" else request.call_id,
            name=request.name,
            state=pb.EXECUTION_RESULT_STATE_FAILED
            if failure in {"failed", "wrong_state"}
            else pb.EXECUTION_RESULT_STATE_SUCCEEDED,
            result_event_id=event_id,
        )
        ParseDict({"spoofed_wire": "不作为事实"}, response.result)
        return response

    server = grpc.aio.server()
    server.add_generic_rpc_handlers(
        (
            grpc.method_handlers_generic_handler(
                "glimmer.capabilities.v1.CapabilityService",
                {
                    "ExposeStep": grpc.unary_unary_rpc_method_handler(
                        expose,
                        request_deserializer=pb.ExposeStepRequest.FromString,
                        response_serializer=pb.ExposeStepResponse.SerializeToString,
                    ),
                    "InvokeTool": grpc.unary_unary_rpc_method_handler(
                        invoke,
                        request_deserializer=pb.InvokeToolRequest.FromString,
                        response_serializer=pb.InvokeToolResponse.SerializeToString,
                    ),
                },
            ),
        )
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    channel = grpc.aio.insecure_channel(f"127.0.0.1:{port}")
    transport = KernelGrpcClient("generation-1", "nonce", "AA")
    transport._channel = channel
    client = CapabilityClient(transport, context, recorder, "trace")
    try:
        surface = await client.expose(
            scope="conversation", run_id="run", step=1, remaining_calls=1
        )
        assert len(surface.tools) == len(surface.skills) == 1
        call = CapabilityInvocation(
            run_id="run",
            step=1,
            call_id="call",
            name="tool_weather",
            arguments={"city": "上海"},
            idempotency_key="run:call",
            definition_id='["weather","lookup"]',
            definition_revision="other" if failure == "unexposed" else "revision",
        )
        if failure in {"none", "failed"}:
            result = await client.invoke(call)
            assert result.output == (None if failure == "failed" else {"actual": "晴"})
            assert result.status == ("failed" if failure == "failed" else "succeeded")
            if failure == "failed":
                assert result.error == "authorization_denied"
            assert (await client.invoke(call)) == result
            assert dispatched[0].source_fact_id == dispatched[1].source_fact_id
        else:
            with pytest.raises((ValueError, RuntimeError)):
                await client.invoke(call)
        if failure == "unexposed":
            assert dispatched == []
    finally:
        await channel.close()
        await server.stop(0)
        await recorder.stop()
