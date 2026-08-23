import asyncio

import grpc
import pytest

from glimmer.common.v1 import service_contract_pb2 as common_pb
from glimmer.cognition.v1 import cognition_service_pb2 as cognition_pb
from glimmer.kernel.v1 import kernel_control_service_pb2 as kernel_pb
from glimmer_cradle.cognition.adapters.kernel.grpc_transport import CognitionGrpcHost, KernelGrpcClient, KernelServiceError
from glimmer_cradle.cognition.cycle.perception_operations import PerceptionOperationRegistry
from glimmer_cradle.cognition.cycle import CycleController
from glimmer_cradle.cognition.cycle.perception_queue import PerceptionEventQueue
from glimmer_cradle.cognition.cycle.providers import PerceptionProvider
from glimmer_cradle.cognition.cycle.volition import WillingnessConfig
from glimmer_cradle.cognition.experience.recorder import ExperienceRecorder
from glimmer_cradle.cognition.cycle.workspace import GlobalWorkspace
from glimmer_cradle.cognition.ports.kernel.models import AgentPlanResult


class _Queue:
    def __init__(self, max_size: int | None = None) -> None:
        self.entries = []
        self.max_size = max_size

    def put(self, entry):
        dropped = None
        if self.max_size is not None and len(self.entries) >= self.max_size:
            dropped = self.entries.pop(0)
        self.entries.append(entry)
        return dropped

    def remove(self, trace_id: str) -> bool:
        before = len(self.entries)
        self.entries = [entry for entry in self.entries if entry.trace_id != trace_id]
        return len(self.entries) != before


class _Activity:
    def engage(self, _reason: str) -> None:
        pass

    def observe_activity(self, _reason: str) -> None:
        pass


class _Cycle:
    def notify_external_input(self) -> None:
        pass


class _Inbound:
    async def on_knowledge_init(self, _knowledge) -> None:
        pass

    async def on_agent_plan(self, input_data):
        if input_data.user_goal == "wait":
            await asyncio.sleep(30)
        return AgentPlanResult(
            summary="ok",
            reasoning="tested",
            suggestions=[],
            trace_id=input_data.trace_id,
        )

    async def on_agent_synthesis(self, _input_data):
        raise AssertionError("not used")

    async def on_conversation_history(self, _payload):
        raise AssertionError("not used")


def _metadata(generation: str, trace_id: str, key: str = ""):
    return common_pb.CallMetadata(
        trace_id=trace_id,
        causation_id="cause-1",
        correlation_id="correlation-1",
        generation=generation,
        idempotency_key=key,
    )


def _call(channel, method: str, request_type, response_type):
    return channel.unary_unary(
        f"/glimmer.cognition.v1.CognitionService/{method}",
        request_serializer=request_type.SerializeToString,
        response_deserializer=response_type.FromString,
    )


@pytest.fixture
async def service():
    stopped = asyncio.Event()

    async def shutdown() -> None:
        stopped.set()

    queue = _Queue()
    host = CognitionGrpcHost(
        generation="generation-1",
        inbound=_Inbound(),
        queue=queue,
        activity=_Activity(),
        cycle=_Cycle(),
        shutdown=shutdown,
        operations=PerceptionOperationRegistry(),
        workspace=GlobalWorkspace(),
    )
    await host.start()
    host.mark_ready()
    channel = grpc.aio.insecure_channel(host.endpoint.removeprefix("grpc://"))
    try:
        yield host, channel, queue, stopped
    finally:
        await channel.close()
        await host.stop()


@pytest.mark.asyncio
async def test_perception_is_versioned_idempotent_and_generation_scoped(service):
    _host, channel, queue, _stopped = service
    submit = _call(channel, "SubmitPerception", cognition_pb.SubmitPerceptionRequest, cognition_pb.SubmitPerceptionResponse)
    request = cognition_pb.SubmitPerceptionRequest(
        call=_metadata("generation-1", "trace-1", "perception-1"),
        perception_id="perception-1",
        familiarity=10,
        address_mode=cognition_pb.ADDRESS_MODE_DIRECT,
        response_policy=cognition_pb.RESPONSE_POLICY_REPLY_ALLOWED,
        retention_ceiling=cognition_pb.RETENTION_CEILING_EXPERIENCE,
        conversation=cognition_pb.ConversationContext(
            scene_id="scene-1",
            conversation_id="conversation-1",
            continuity_id="continuity-1",
            thread_id="main",
            interaction_id="trace-1",
            recall_scope="conversation_private",
            disclosure_scope="conversation_private",
        ),
        content=cognition_pb.PerceptionContent(text="hello"),
    )
    first = await submit(request, timeout=1)
    second = await submit(request, timeout=1)
    assert first.state == cognition_pb.PERCEPTION_OPERATION_STATE_ACCEPTED
    assert second.duplicate is True
    assert len(queue.entries) == 1
    assert queue.entries[0].trace_id == "trace-1"

    conflicting_trace = cognition_pb.SubmitPerceptionRequest()
    conflicting_trace.CopyFrom(request)
    conflicting_trace.call.trace_id = "trace-conflict"
    with pytest.raises(grpc.aio.AioRpcError) as operation_conflict:
        await submit(conflicting_trace, timeout=1)
    assert operation_conflict.value.code() is grpc.StatusCode.INVALID_ARGUMENT

    conflicting_operation = cognition_pb.SubmitPerceptionRequest()
    conflicting_operation.CopyFrom(request)
    conflicting_operation.call.idempotency_key = "perception-other"
    with pytest.raises(grpc.aio.AioRpcError) as trace_conflict:
        await submit(conflicting_operation, timeout=1)
    assert trace_conflict.value.code() is grpc.StatusCode.INVALID_ARGUMENT
    assert len(queue.entries) == 1

    request.call.generation = "stale-generation"
    with pytest.raises(grpc.aio.AioRpcError) as caught:
        await submit(request, timeout=1)
    assert caught.value.code() is grpc.StatusCode.PERMISSION_DENIED
    detail = dict(caught.value.trailing_metadata())["glimmer-error-bin"]
    error = common_pb.ServiceErrorDetail.FromString(detail)
    assert error.code == common_pb.SERVICE_ERROR_CODE_GENERATION_MISMATCH
    assert error.call.causation_id == "cause-1"
    assert error.call.correlation_id == "correlation-1"


@pytest.mark.asyncio
async def test_queue_capacity_drop_closes_the_accepted_perception_operation() -> None:
    operations = PerceptionOperationRegistry()
    host = CognitionGrpcHost(
        generation="generation-capacity",
        inbound=_Inbound(),
        queue=_Queue(max_size=1),
        activity=_Activity(),
        cycle=_Cycle(),
        shutdown=lambda: asyncio.sleep(0),
        operations=operations,
        workspace=GlobalWorkspace(),
    )
    await host.start()
    host.mark_ready()
    channel = grpc.aio.insecure_channel(host.endpoint.removeprefix("grpc://"))
    submit = _call(channel, "SubmitPerception", cognition_pb.SubmitPerceptionRequest, cognition_pb.SubmitPerceptionResponse)
    status = _call(channel, "GetPerceptionOperation", cognition_pb.GetPerceptionOperationRequest, cognition_pb.GetPerceptionOperationResponse)
    try:
        for trace_id in ("trace-old", "trace-new"):
            await submit(cognition_pb.SubmitPerceptionRequest(
                call=_metadata("generation-capacity", trace_id, f"operation:{trace_id}"),
                perception_id=trace_id,
                content=cognition_pb.PerceptionContent(text=trace_id),
            ), timeout=1)
        dropped = await status(cognition_pb.GetPerceptionOperationRequest(
            call=_metadata("generation-capacity", "status-old"),
            operation_id="operation:trace-old",
        ), timeout=1)
        assert dropped.terminal is True
        assert dropped.state == cognition_pb.PERCEPTION_OPERATION_STATE_FAILED
        assert dropped.safe_message == "感知队列容量已满"
    finally:
        await channel.close()
        await host.stop()


@pytest.mark.asyncio
async def test_deadline_and_perception_cancellation_reach_terminal_state(service):
    _host, channel, _queue, _stopped = service
    plan = _call(channel, "Plan", cognition_pb.PlanRequest, cognition_pb.PlanResponse)
    cancel = _call(channel, "CancelPerception", cognition_pb.CancelPerceptionRequest, cognition_pb.CancelPerceptionResponse)

    with pytest.raises(grpc.aio.AioRpcError) as deadline:
        await plan(cognition_pb.PlanRequest(call=_metadata("generation-1", "deadline-trace"), user_goal="wait"), timeout=0.03)
    assert deadline.value.code() is grpc.StatusCode.DEADLINE_EXCEEDED

    submit = _call(channel, "SubmitPerception", cognition_pb.SubmitPerceptionRequest, cognition_pb.SubmitPerceptionResponse)
    status = _call(channel, "GetPerceptionOperation", cognition_pb.GetPerceptionOperationRequest, cognition_pb.GetPerceptionOperationResponse)
    await submit(cognition_pb.SubmitPerceptionRequest(
        call=_metadata("generation-1", "cancel-trace", "perception-cancel"),
        address_mode=cognition_pb.ADDRESS_MODE_DIRECT,
        conversation=cognition_pb.ConversationContext(scene_id="scene-1"),
        content=cognition_pb.PerceptionContent(text="cancel me"),
    ), timeout=1)
    result = await cancel(cognition_pb.CancelPerceptionRequest(
        call=_metadata("generation-1", "cancel-command"),
        target_trace_id="cancel-trace",
        reason="test",
    ), timeout=1)
    assert result.state == cognition_pb.PERCEPTION_OPERATION_STATE_CANCELLED
    assert result.terminal is True
    terminal = await status(cognition_pb.GetPerceptionOperationRequest(
        call=_metadata("generation-1", "status-command"),
        operation_id="perception-cancel",
    ), timeout=1)
    assert terminal.terminal is True
    assert terminal.state == cognition_pb.PERCEPTION_OPERATION_STATE_CANCELLED


@pytest.mark.asyncio
async def test_second_ingress_cancels_the_real_cycle_through_grpc(tmp_path) -> None:
    started = asyncio.Event()
    emitted: list[dict] = []

    class _SlowReasoning:
        async def request(self, _request, *, tier):
            started.set()
            await asyncio.Future()

    queue = PerceptionEventQueue(max_size=10)
    operations = PerceptionOperationRegistry()
    workspace = GlobalWorkspace(capacity=5)
    recorder = ExperienceRecorder(tmp_path)
    await recorder.start()
    cycle = CycleController(
        workspace=workspace,
        providers=[PerceptionProvider(queue)],
        experience_recorder=recorder,
        willingness_config=WillingnessConfig(threshold_by_activity={"engaged": 0.2}),
        reasoning=_SlowReasoning(),
        action_sink=lambda command: _append_async(emitted, command),
        perception_operations=operations,
    )
    host = CognitionGrpcHost(
        generation="generation-cycle",
        inbound=_Inbound(),
        queue=queue,
        activity=_Activity(),
        cycle=cycle,
        shutdown=lambda: asyncio.sleep(0),
        operations=operations,
        workspace=workspace,
    )
    await host.start()
    host.mark_ready()
    channel = grpc.aio.insecure_channel(host.endpoint.removeprefix("grpc://"))
    submit = _call(channel, "SubmitPerception", cognition_pb.SubmitPerceptionRequest, cognition_pb.SubmitPerceptionResponse)
    cancel = _call(channel, "CancelPerception", cognition_pb.CancelPerceptionRequest, cognition_pb.CancelPerceptionResponse)
    status = _call(channel, "GetPerceptionOperation", cognition_pb.GetPerceptionOperationRequest, cognition_pb.GetPerceptionOperationResponse)
    try:
        await submit(_perception_request("generation-cycle", "trace-first", "operation:first", "first"), timeout=1)
        tick = asyncio.create_task(cycle.tick_once())
        await asyncio.wait_for(started.wait(), timeout=1)
        cancelled = await cancel(cognition_pb.CancelPerceptionRequest(
            call=_metadata("generation-cycle", "cancel-first"),
            target_trace_id="trace-first",
            reason="new_ingress_interrupt",
        ), timeout=1)
        await submit(_perception_request("generation-cycle", "trace-second", "operation:second", "second"), timeout=1)

        assert tick.cancelled()
        assert cancelled.terminal is True
        first_terminal = await status(cognition_pb.GetPerceptionOperationRequest(
            call=_metadata("generation-cycle", "status-first"), operation_id="operation:first",
        ), timeout=1)
        assert first_terminal.state == cognition_pb.PERCEPTION_OPERATION_STATE_CANCELLED
        assert queue.size() == 1
        assert emitted == []
    finally:
        await channel.close()
        await host.stop()
        await recorder.stop()


async def _append_async(target: list[dict], value: dict) -> None:
    target.append(value)


def _perception_request(generation: str, trace_id: str, operation_id: str, text: str):
    return cognition_pb.SubmitPerceptionRequest(
        call=_metadata(generation, trace_id, operation_id),
        familiarity=10,
        address_mode=cognition_pb.ADDRESS_MODE_DIRECT,
        response_policy=cognition_pb.RESPONSE_POLICY_REPLY_ALLOWED,
        conversation=cognition_pb.ConversationContext(
            scene_id="scene-1", conversation_id="conversation-1", continuity_id="continuity-1",
            thread_id="main", interaction_id=trace_id, recall_scope="conversation_private",
            disclosure_scope="conversation_private",
        ),
        content=cognition_pb.PerceptionContent(text=text),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["cancel", "deadline"])
async def test_synthesis_cancellation_reaches_the_running_use_case(mode: str) -> None:
    started = asyncio.Event()
    cancelled = asyncio.Event()

    class _SlowSynthesisInbound(_Inbound):
        async def on_agent_synthesis(self, _input_data):
            started.set()
            try:
                await asyncio.Future()
            finally:
                cancelled.set()

    host = CognitionGrpcHost(
        generation="generation-synthesis",
        inbound=_SlowSynthesisInbound(),
        queue=_Queue(),
        activity=_Activity(),
        cycle=_Cycle(),
        shutdown=lambda: asyncio.sleep(0),
        operations=PerceptionOperationRegistry(),
        workspace=GlobalWorkspace(),
    )
    await host.start()
    host.mark_ready()
    channel = grpc.aio.insecure_channel(host.endpoint.removeprefix("grpc://"))
    synthesize = _call(channel, "Synthesize", cognition_pb.SynthesizeRequest, cognition_pb.SynthesizeResponse)
    try:
        pending = synthesize(cognition_pb.SynthesizeRequest(
            call=_metadata("generation-synthesis", f"synthesis-{mode}"),
            original_goal="wait",
        ), timeout=0.03 if mode == "deadline" else 5)
        await asyncio.wait_for(started.wait(), timeout=1)
        if mode == "cancel":
            pending.cancel()
        with pytest.raises((asyncio.CancelledError, grpc.aio.AioRpcError)):
            await pending
        await asyncio.wait_for(cancelled.wait(), timeout=1)
    finally:
        await channel.close()
        await host.stop()


@pytest.mark.asyncio
async def test_readiness_and_shutdown_are_generation_bound(service):
    _host, channel, _queue, stopped = service
    readiness = _call(channel, "GetReadiness", cognition_pb.GetReadinessRequest, cognition_pb.GetReadinessResponse)
    shutdown = _call(channel, "Shutdown", cognition_pb.ShutdownRequest, cognition_pb.ShutdownResponse)
    ready = await readiness(cognition_pb.GetReadinessRequest(call=_metadata("generation-1", "ready-trace")), timeout=1)
    assert (ready.state, ready.phase, ready.generation) == ("ready", "ready", "generation-1")
    result = await shutdown(cognition_pb.ShutdownRequest(call=_metadata("generation-1", "shutdown-trace", "shutdown-1"), reason="test"), timeout=1)
    assert result.status == "accepted"
    await asyncio.wait_for(stopped.wait(), timeout=1)


@pytest.mark.asyncio
async def test_kernel_typed_error_preserves_safe_metadata_without_raw_details():
    detail = common_pb.ServiceErrorDetail(
        code=common_pb.SERVICE_ERROR_CODE_NOT_READY,
        safe_message="Kernel action handler 尚未就绪",
        retryable=True,
        call=_metadata("generation-1", "trace-safe"),
    )

    class _Channel:
        def unary_unary(self, *_args, **_kwargs):
            async def invoke(_request, timeout=None):
                raise grpc.aio.AioRpcError(
                    grpc.StatusCode.FAILED_PRECONDITION,
                    trailing_metadata=(("glimmer-error-bin", detail.SerializeToString()),),
                    details="private stack and provider token",
                )
            return invoke

    client = KernelGrpcClient("generation-1", "nonce", "AA")
    client._channel = _Channel()  # type: ignore[assignment]
    with pytest.raises(KernelServiceError) as caught:
        await client._call("PublishLog", kernel_pb.PublishLogRequest(), kernel_pb.PublishLogRequest, kernel_pb.PublishLogResponse)
    assert caught.value.code == common_pb.SERVICE_ERROR_CODE_NOT_READY
    assert caught.value.safe_message == "Kernel action handler 尚未就绪"
    assert caught.value.retryable is True
    assert caught.value.call.trace_id == "trace-safe"
    assert caught.value.call.causation_id == "cause-1"
    assert caught.value.call.correlation_id == "correlation-1"
    assert caught.value.call.generation == "generation-1"
    assert "private stack" not in str(caught.value)


@pytest.mark.asyncio
async def test_kernel_manual_recovery_is_programmatic_and_not_message_driven():
    detail = common_pb.ServiceErrorDetail(
        code=common_pb.SERVICE_ERROR_CODE_RECOVERY_REQUIRED,
        safe_message="localized text may change",
        retryable=False,
        call=_metadata("generation-1", "trace-recovery"),
        recovery_actions=[common_pb.SERVICE_RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE],
        operation_id="action:unsafe:tool:0",
    )

    class _Channel:
        def unary_unary(self, *_args, **_kwargs):
            async def invoke(_request, timeout=None):
                raise grpc.aio.AioRpcError(
                    grpc.StatusCode.FAILED_PRECONDITION,
                    trailing_metadata=(("glimmer-error-bin", detail.SerializeToString()),),
                    details="untrusted transport text",
                )
            return invoke

    client = KernelGrpcClient("generation-1", "nonce", "AA")
    client._channel = _Channel()  # type: ignore[assignment]
    with pytest.raises(KernelServiceError) as caught:
        await client._call(
            "PublishAction",
            kernel_pb.PublishActionRequest(),
            kernel_pb.PublishActionRequest,
            kernel_pb.PublishActionResponse,
        )
    assert caught.value.code == common_pb.SERVICE_ERROR_CODE_RECOVERY_REQUIRED
    assert caught.value.retryable is False
    assert caught.value.operation_id == "action:unsafe:tool:0"
    assert caught.value.recovery_actions == (
        common_pb.SERVICE_RECOVERY_ACTION_CONFIRM_SIDE_EFFECT_STATE,
    )
    assert caught.value.call.trace_id == "trace-recovery"


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
