"""Typed Capability Service adapter；原 ACTION 刷盘，结果只消费真实 Log 接纳。"""

from __future__ import annotations

from typing import Protocol

from glimmer.capabilities.v1 import capabilities_pb2 as capability_pb
from glimmer_cradle.cognition.ports import (
    CapabilityDescriptor,
    CapabilityExposure,
    CapabilityInvocation,
    CapabilityResult,
    ResourceDescriptor,
    SkillReference,
    SkillSummary,
)
from glimmer_cradle.conversation import ConversationRecorder, MomentKind
from google.protobuf.json_format import MessageToDict, ParseDict


class CapabilityRpcPort(Protocol):
    async def expose_step(
        self, request: capability_pb.ExposeStepRequest, trace_id: str
    ) -> capability_pb.ExposeStepResponse: ...
    async def invoke_tool(
        self, request: capability_pb.InvokeToolRequest, trace_id: str
    ) -> capability_pb.InvokeToolResponse: ...


class CapabilityClient:
    def __init__(
        self,
        transport: CapabilityRpcPort,
        conversation: dict[str, str],
        recorder: ConversationRecorder,
        trace_id: str,
    ) -> None:
        for field in (
            "conversation_id",
            "source_provider_id",
            "scene_id",
            "thread_id",
            "interaction_id",
            "continuity_id",
            "recall_scope",
            "disclosure_scope",
        ):
            if (
                not isinstance(conversation.get(field), str)
                or not conversation[field].strip()
            ):
                raise ValueError("native capability context is incomplete")
        if not trace_id or any(
            conversation[field] not in {"public", "space_local", "conversation_private"}
            for field in ("recall_scope", "disclosure_scope")
        ):
            raise ValueError("native capability trace/privacy context is invalid")
        self._transport = transport
        self._conversation = dict(conversation)
        self._recorder = recorder
        self._trace_id = trace_id
        self._exposures: dict[tuple[str, int], CapabilityExposure] = {}

    def _scope(self) -> capability_pb.CapabilityScopeContext:
        context = self._conversation
        scope = capability_pb.CapabilityScopeContext(
            source_provider_id=context["source_provider_id"],
            scene_id=context["scene_id"],
            conversation_id=context["conversation_id"],
        )
        if "user_id" in context:
            scope.user_id = context["user_id"]
        return scope

    async def expose(
        self, *, scope: str, run_id: str, step: int, remaining_calls: int
    ) -> CapabilityExposure:
        if scope != self._conversation["conversation_id"]:
            raise ValueError("native capability scope mismatch")
        response = await self._transport.expose_step(
            capability_pb.ExposeStepRequest(
                run_id=run_id,
                step=step,
                scope=self._scope(),
                protocol_features=["tool-call.v1"],
                max_definitions=128,
                max_definition_bytes=64 * 1024,
                remaining_tool_calls=remaining_calls,
            ),
            self._trace_id,
        )
        if response.run_id != run_id or response.step != step:
            raise ValueError("native exposure identity mismatch")

        def descriptor(item, model):
            if (
                not item.HasField("reference")
                or not item.reference.id
                or not item.reference.revision
                or not item.name
            ):
                raise ValueError("native exposure definition reference missing")
            schema = (
                MessageToDict(item.input_schema)
                if item.HasField("input_schema")
                else {}
            )
            if schema is None:
                schema = {}
            if not isinstance(schema, (dict, bool)):
                raise ValueError("native exposure input schema invalid")
            return model(
                name=item.name,
                description=item.description,
                definition_id=item.reference.id,
                definition_revision=item.reference.revision,
                input_schema=schema,
            )

        tools = tuple(descriptor(item, CapabilityDescriptor) for item in response.tools)
        if len({item.name for item in tools}) != len(tools):
            raise ValueError("duplicate native tool names")
        skills = tuple(
            SkillSummary(
                SkillReference(
                    item.reference.skill_id, item.reference.definition_revision
                ),
                item.name,
                item.description,
            )
            for item in response.skills
        )
        exposure = CapabilityExposure(
            run_id,
            step,
            tools,
            skills,
            tuple(descriptor(item, ResourceDescriptor) for item in response.resources),
            response.used_definition_bytes,
            response.truncated,
        )
        if (
            response.used_definition_bytes > 64 * 1024
            or len(tools) + len(skills) + len(exposure.resources) > 128
        ):
            raise ValueError("native exposure budget exceeded")
        self._exposures[(run_id, step)] = exposure
        if len(self._exposures) > 128:
            self._exposures.pop(next(iter(self._exposures)))
        return exposure

    async def invoke(self, invocation: CapabilityInvocation) -> CapabilityResult:
        exposure = self._exposures.get((invocation.run_id, invocation.step))
        if exposure is None or not any(
            item.name == invocation.name
            and item.definition_id == invocation.definition_id
            and item.definition_revision == invocation.definition_revision
            for item in exposure.tools
        ):
            raise ValueError("native tool not exposed")
        if invocation.idempotency_key != f"{invocation.run_id}:{invocation.call_id}":
            raise ValueError("native invocation key mismatch")
        context = self._conversation
        source = self._recorder.record(
            MomentKind.ACTION,
            {
                "action_type": "tool_call",
                "run_id": invocation.run_id,
                "step": invocation.step,
                "call_id": invocation.call_id,
                "definition_id": invocation.definition_id,
                "definition_revision": invocation.definition_revision,
                "arguments": invocation.arguments,
            },
            **{
                key: context[key]
                for key in (
                    "conversation_id",
                    "scene_id",
                    "continuity_id",
                    "thread_id",
                    "interaction_id",
                    "recall_scope",
                    "disclosure_scope",
                )
            },
            actor_id=context.get("actor_id"),
            trace_id=self._trace_id,
            idempotency_key=f"native-tool-action:{invocation.idempotency_key}",
        )
        if source is None:
            raise RuntimeError("native ToolCall has no durable ACTION")
        await self._recorder.flush()
        request = capability_pb.InvokeToolRequest(
            run_id=invocation.run_id,
            step=invocation.step,
            call_id=invocation.call_id,
            name=invocation.name,
            reference=capability_pb.CapabilityReference(
                id=invocation.definition_id, revision=invocation.definition_revision
            ),
            scope=self._scope(),
            source_fact_id=source.moment_id,
        )
        request.call.idempotency_key = invocation.idempotency_key
        ParseDict(invocation.arguments, request.arguments)
        response = await self._transport.invoke_tool(request, self._trace_id)
        if (
            response.call_id != invocation.call_id
            or response.name != invocation.name
            or not response.result_event_id
        ):
            raise ValueError("native Tool result identity mismatch")
        moment = self._recorder.execution_result(response.result_event_id)
        if (
            moment is None
            or moment.content.get("invocation_id") != invocation.idempotency_key
            or moment.content.get("source_fact_id") != source.moment_id
            or moment.content.get("definition_revision")
            != invocation.definition_revision
            or any(
                getattr(moment, field) != context[field]
                for field in (
                    "conversation_id",
                    "scene_id",
                    "continuity_id",
                    "thread_id",
                    "interaction_id",
                    "recall_scope",
                    "disclosure_scope",
                )
            )
        ):
            raise RuntimeError(
                "native Tool result not durably accepted or context conflict"
            )
        state = moment.content.get("state")
        if state not in {"succeeded", "failed", "unknown"}:
            raise ValueError("native durable result state invalid")
        expected_state = {
            "succeeded": capability_pb.EXECUTION_RESULT_STATE_SUCCEEDED,
            "failed": capability_pb.EXECUTION_RESULT_STATE_FAILED,
            "unknown": capability_pb.EXECUTION_RESULT_STATE_UNKNOWN,
        }[state]
        if response.state != expected_state:
            raise ValueError(
                "native result state projection conflicts with durable fact"
            )
        return CapabilityResult(
            invocation.call_id,
            invocation.name,
            state,
            output=moment.content.get("result") if state == "succeeded" else None,
            error=moment.content.get("error_code") or None,
        )
