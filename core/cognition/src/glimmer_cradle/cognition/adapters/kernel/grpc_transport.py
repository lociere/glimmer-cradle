"""Kernel–Cognition v1 gRPC transport。

此模块只拥有跨进程 DTO、状态码、deadline/cancellation 与端点生命周期；
应用语义通过 KernelRequestPort 和事件队列进入 Cognition。
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import os
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from typing import Any

import grpc
from google.protobuf.json_format import MessageToDict, ParseDict

from glimmer.common.v1 import service_contract_pb2 as common_pb
from glimmer.cognition.v1 import cognition_service_pb2 as cognition_pb
from glimmer.kernel.v1 import kernel_control_service_pb2 as kernel_pb
from glimmer_cradle.cognition.activity import CognitiveActivityController
from glimmer_cradle.cognition.application.agent_plan_use_case import AgentPlanInput
from glimmer_cradle.cognition.application.agent_synthesis_use_case import AgentSynthesisInput
from glimmer_cradle.cognition.cycle import CycleController
from glimmer_cradle.cognition.cycle.perception_queue import PerceptionEntry, PerceptionEventQueue
from glimmer_cradle.cognition.cycle.perception_operations import (
    PerceptionOperationConflict,
    PerceptionOperationRegistry,
)
from glimmer_cradle.cognition.cycle.workspace import GlobalWorkspace
from glimmer_cradle.cognition.observability.logger import get_logger
from glimmer_cradle.cognition.observability.trace_context import TraceContext, new_trace_id
from glimmer_cradle.cognition.ports.kernel.inbound.kernel_request_port import KernelRequestPort
from glimmer_cradle.cognition.ports.kernel.models import (
    ConversationHistoryQuery,
    KnowledgeEntryInput,
    KnowledgeInitialization,
    KnowledgeRetrievalInput,
    SkillToolDescriptor,
)

logger = get_logger("kernel_cognition_grpc")
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

    def __init__(self, code: int, safe_message: str, *, retryable: bool = False, call: Any = None) -> None:
        super().__init__(safe_message)
        self.code = code
        self.safe_message = safe_message
        self.retryable = retryable
        self.call = call


def _grpc_status(code: int) -> grpc.StatusCode:
    return {
        common_pb.SERVICE_ERROR_CODE_INVALID_REQUEST: grpc.StatusCode.INVALID_ARGUMENT,
        common_pb.SERVICE_ERROR_CODE_NOT_READY: grpc.StatusCode.FAILED_PRECONDITION,
        common_pb.SERVICE_ERROR_CODE_GENERATION_MISMATCH: grpc.StatusCode.PERMISSION_DENIED,
        common_pb.SERVICE_ERROR_CODE_CANCELLED: grpc.StatusCode.CANCELLED,
        common_pb.SERVICE_ERROR_CODE_DEADLINE_EXCEEDED: grpc.StatusCode.DEADLINE_EXCEEDED,
        common_pb.SERVICE_ERROR_CODE_UNAVAILABLE: grpc.StatusCode.UNAVAILABLE,
    }.get(code, grpc.StatusCode.INTERNAL)


class CognitionGrpcHost:
    """由 CognitionHost 监督的动态回环 gRPC Service host。"""

    def __init__(
        self,
        *,
        generation: str,
        inbound: KernelRequestPort,
        queue: PerceptionEventQueue,
        activity: CognitiveActivityController,
        cycle: CycleController,
        shutdown: Callable[[], Awaitable[None]],
        operations: PerceptionOperationRegistry,
        workspace: GlobalWorkspace,
    ) -> None:
        self.generation = generation
        self._inbound = inbound
        self._queue = queue
        self._activity = activity
        self._cycle = cycle
        self._shutdown = shutdown
        self._operations = operations
        self._workspace = workspace
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
        logger.info("Cognition gRPC Service 已绑定动态回环端点")

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
            logger.exception("Cognition gRPC 调用失败")
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
                model_input = {
                    "text": content.text,
                    "actor_id": content.actor_id or None,
                    "actor_name": content.actor_name or None,
                    "modality": list(content.modality),
                    "items": [MessageToDict(item, preserving_proto_field_name=True) for item in content.items],
                }
                conversation = request.conversation
                address_mode = "direct" if request.address_mode == cognition_pb.ADDRESS_MODE_DIRECT else "ambient"
                response_policy = "observe_only" if request.response_policy == cognition_pb.RESPONSE_POLICY_OBSERVE_ONLY else "reply_allowed"
                retention = {
                    cognition_pb.RETENTION_CEILING_TRANSIENT: "transient",
                    cognition_pb.RETENTION_CEILING_MEMORY_CANDIDATE: "memory_candidate",
                }.get(request.retention_ceiling, "experience")
                dropped = self._queue.put(PerceptionEntry(
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
                ))
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
                asyncio.create_task(self._shutdown())
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
