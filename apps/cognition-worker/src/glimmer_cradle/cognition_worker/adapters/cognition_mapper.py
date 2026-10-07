"""Cognition wire/Port 映射；感知在进入 operation registry 前完成校验。"""

from __future__ import annotations

import hashlib

from glimmer.cognition.v1 import cognition_service_pb2 as cognition_pb
from glimmer_cradle.cognition.inference import (
    InferenceRequest,
    ModelEvent,
    ModelEventKind,
)
from glimmer_cradle.cognition.perception import Observation, ObservationNormalizer
from glimmer_cradle.cognition.ports import (
    AgentPlanInput,
    AgentPlanResult,
    AgentSynthesisInput,
    AgentSynthesisOutput,
    KnowledgeEntryInput,
    KnowledgeInitialization,
    KnowledgeRetrievalInput,
    SkillMaterial,
    SkillReference,
    SkillSummary,
    SkillToolDescriptor,
)
from google.protobuf.json_format import MessageToDict, ParseDict


def inference_request_to_wire(request: InferenceRequest) -> dict[str, object]:
    return {
        "system": request.system,
        "user": request.user,
        "max_tokens": request.max_tokens,
        "temperature": request.temperature,
        "metadata": request.metadata,
        "vision": [list(item) for item in request.vision],
        "provider_key": request.provider_key,
    }


def model_event_from_wire(value: dict[str, object]) -> ModelEvent:
    sequence = value.get("sequence")
    kind = value.get("kind")
    payload = value.get("payload", {})
    if not isinstance(sequence, int) or sequence < 0:
        raise ValueError("model event sequence must be a non-negative integer")
    if not isinstance(kind, str):
        raise ValueError("model event kind must be a string")  # noqa: TRY004 — wire 输入统一为 ValueError
    if not isinstance(payload, dict):
        raise ValueError("model event payload must be an object")  # noqa: TRY004 — wire 输入统一为 ValueError
    return ModelEvent(sequence=sequence, kind=ModelEventKind(kind), payload=payload)


def observation_from_wire(
    request: cognition_pb.SubmitPerceptionRequest, *, trace_id: str
) -> Observation:
    content = request.content
    conversation = request.conversation
    payload_digest = (
        request.origin.content_hash.strip()
        or hashlib.sha256(request.SerializeToString(deterministic=True)).hexdigest()
    )
    return ObservationNormalizer().normalize(
        Observation(
            scene_id=conversation.scene_id,
            conversation_id=conversation.conversation_id,
            continuity_id=conversation.continuity_id,
            thread_id=conversation.thread_id,
            recall_scope=conversation.recall_scope,
            disclosure_scope=conversation.disclosure_scope,
            address_mode="direct"
            if request.address_mode == cognition_pb.ADDRESS_MODE_DIRECT
            else "ambient",
            familiarity=request.familiarity,
            response_policy="observe_only"
            if request.response_policy == cognition_pb.RESPONSE_POLICY_OBSERVE_ONLY
            else "reply_allowed",
            text=content.text,
            trace_id=trace_id,
            actor_id=content.actor_id or None,
            actor_name=content.actor_name or None,
            model_input={
                "text": content.text,
                "actor_id": content.actor_id or None,
                "actor_name": content.actor_name or None,
                "modality": list(content.modality),
                "items": [
                    MessageToDict(item, preserving_proto_field_name=True)
                    for item in content.items
                ],
                "parts": [
                    MessageToDict(part, preserving_proto_field_name=True)
                    for part in content.parts
                ],
            },
            origin=MessageToDict(request.origin, preserving_proto_field_name=True),
            retention_ceiling={
                cognition_pb.RETENTION_CEILING_TRANSIENT: "transient",
                cognition_pb.RETENTION_CEILING_MEMORY_CANDIDATE: "memory_candidate",
            }.get(request.retention_ceiling, "experience"),
            interaction_id=conversation.interaction_id,
            payload_digest=payload_digest,
        )
    )


def knowledge_initialization_from_wire(
    request: cognition_pb.InitializeKnowledgeRequest,
) -> KnowledgeInitialization:
    return KnowledgeInitialization(
        version=request.version,
        retrieval=KnowledgeRetrievalInput(
            mode=request.retrieval.mode or "full_injection",
            top_k=request.retrieval.top_k or 5,
            min_score=request.retrieval.min_score,
            semantic_weight=request.retrieval.semantic_weight,
        ),
        entries=[
            KnowledgeEntryInput(
                entry_id=entry.entry_id,
                scope=entry.scope,
                content=entry.content,
                enabled=entry.enabled,
                priority=entry.priority,
            )
            for entry in request.entries
        ],
    )


def agent_plan_from_wire(
    request: cognition_pb.PlanRequest, *, trace_id: str
) -> AgentPlanInput:
    if len(request.available_skills) > 1024 or len(request.skill_materials) > 2:
        raise ValueError("skill planning input exceeds count budget")
    summaries = []
    materials = []
    seen = set()
    for item in request.available_skills:
        if not item.HasField("reference") or not item.name.strip():
            raise ValueError("missing skill summary identity")
        reference = SkillReference(item.reference.skill_id, item.reference.definition_revision)
        if reference.skill_id in seen:
            raise ValueError("duplicate skill summary")
        seen.add(reference.skill_id)
        summaries.append(SkillSummary(reference, item.name, item.description))
    seen.clear()
    if sum(len(item.instructions.encode("utf-8")) for item in request.skill_materials) > 64 * 1024:
        raise ValueError("skill material exceeds byte budget")
    for item in request.skill_materials:
        if not item.HasField("reference"):
            raise ValueError("missing skill material identity")
        reference = SkillReference(item.reference.skill_id, item.reference.definition_revision)
        if reference.skill_id in seen:
            raise ValueError("duplicate skill material")
        seen.add(reference.skill_id)
        materials.append(SkillMaterial(reference, item.instructions))
    return AgentPlanInput(
        user_goal=request.user_goal,
        scene_id=request.scene_id,
        trace_id=trace_id,
        available_skills=summaries,
        skill_materials=materials,
        available_tools=[
            SkillToolDescriptor(
                skill_id=tool.skill_id,
                tool_name=tool.tool_name,
                description=tool.description,
                parameters=MessageToDict(
                    tool.parameters_schema, preserving_proto_field_name=True
                ),
            )
            for tool in request.available_tools
        ],
    )


def agent_plan_to_wire(output: AgentPlanResult) -> cognition_pb.PlanResponse:
    response = cognition_pb.PlanResponse(
        summary=output.summary, reasoning=output.reasoning, trace_id=output.trace_id
    )
    for suggestion in output.suggestions:
        item = response.suggestions.add(
            skill_id=suggestion.skill_id,
            tool_name=suggestion.tool_name,
            purpose=suggestion.purpose,
            confidence=suggestion.confidence,
        )
        ParseDict(suggestion.arguments_hint or {}, item.arguments_hint)
    for reference in output.selected_skills:
        response.selected_skills.add(skill_id=reference.skill_id, definition_revision=reference.definition_revision)
    return response


def agent_synthesis_from_wire(
    request: cognition_pb.SynthesizeRequest, *, trace_id: str
) -> AgentSynthesisInput:
    return AgentSynthesisInput(
        original_goal=request.original_goal,
        scene_id=request.scene_id,
        conversation=MessageToDict(
            request.conversation, preserving_proto_field_name=True
        ),
        tool_results=[
            MessageToDict(item, preserving_proto_field_name=True)
            for item in request.tool_results
        ],
        trace_id=trace_id,
    )


def agent_synthesis_to_wire(
    output: AgentSynthesisOutput,
) -> cognition_pb.SynthesizeResponse:
    response = cognition_pb.SynthesizeResponse(
        reply_content=output.reply_content, trace_id=output.trace_id
    )
    ParseDict(output.emotion_state or {}, response.emotion_state)
    return response
