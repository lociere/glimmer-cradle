"""Conversation Moment 与历史查询 wire/Port 映射，不拥有持久状态。"""

from __future__ import annotations

from dataclasses import asdict

from glimmer.cognition.v1 import cognition_service_pb2 as cognition_pb
from glimmer_cradle.cognition.ports import (
    ConversationHistoryQuery,
    ConversationHistoryResult,
)
from glimmer_cradle.conversation import Moment


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
