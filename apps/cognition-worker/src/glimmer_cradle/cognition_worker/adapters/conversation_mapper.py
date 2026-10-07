"""Conversation Moment 与历史查询 wire/Port 映射，不拥有持久状态。"""

from __future__ import annotations

from dataclasses import asdict

from glimmer.capabilities.v1 import capabilities_pb2 as capabilities_pb
from glimmer.cognition.v1 import cognition_service_pb2 as cognition_pb
from glimmer_cradle.cognition.ports import (
    ConversationHistoryQuery,
    ConversationHistoryResult,
)
from glimmer_cradle.conversation import ExecutionResultFact, Moment
from google.protobuf.json_format import MessageToDict


def execution_result_from_wire(event: capabilities_pb.ExecutionResultEvent) -> ExecutionResultFact:
    states = {1: "succeeded", 2: "failed", 3: "unknown"}
    effects = {1: "none", 2: "confirmed", 3: "unknown"}
    if event.ByteSize() > 128 * 1024 or event.state not in states or event.side_effects not in effects:
        raise ValueError("Execution wire 状态或大小无效")
    if event.HasField("result") != (event.state == capabilities_pb.EXECUTION_RESULT_STATE_SUCCEEDED):
        raise ValueError("Execution wire result presence 无效")
    return ExecutionResultFact(
        event_id=event.event_id, invocation_id=event.invocation_id,
        revision=event.revision, attempt=event.attempt, scope_id=event.scope_id,
        conversation_id=event.conversation_id, source_fact_id=event.source_fact_id,
        executor_id=event.executor_id, capability_id=event.capability_id,
        definition_revision=event.definition_revision, request_digest=event.request_digest,
        state=states[event.state], side_effects=effects[event.side_effects],
        result=MessageToDict(event.result) if event.HasField("result") else None,
        error_code=event.error_code, updated_at_ms=event.updated_at_ms,
    )


def moment_to_wire(moment: Moment) -> dict[str, object]:
    value = asdict(moment)
    value["seq"] = int(moment.seq)
    value["causation_ids"] = list(moment.causation_ids)
    return value


def history_query_from_wire(
    request: cognition_pb.GetConversationHistoryRequest,
) -> ConversationHistoryQuery:
    return ConversationHistoryQuery(
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
    )


def history_result_to_wire(
    output: ConversationHistoryResult,
) -> cognition_pb.GetConversationHistoryResponse:
    response = cognition_pb.GetConversationHistoryResponse(
        request_id=output.request_id,
        status=output.status,
        next_cursor=output.next_cursor or "",
        has_more=output.has_more,
        message=output.message or "",
    )
    if output.conversation:
        response.conversation.CopyFrom(
            cognition_pb.ConversationContext(
                **{
                    field: str(output.conversation.get(field) or "")
                    for field in (
                        "source_provider_id",
                        "scene_id",
                        "conversation_id",
                        "continuity_id",
                        "thread_id",
                        "interaction_id",
                        "recall_scope",
                        "disclosure_scope",
                    )
                }
            )
        )
    for entry in output.items:
        response.items.add(**entry.model_dump(exclude_none=True))
    return response
