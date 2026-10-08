from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "generated" / "python"))

from glimmer.common.v1.contract_probe_pb2 import (  # noqa: E402
    DocumentReference,
    EchoProbeRequest,
    EchoProbeResponse,
    TraceMetadata,
)
from glimmer.content.v1.content_pb2 import AssetRef, ContentPart, FileContent  # noqa: E402
from glimmer.jobs.v1.jobs_pb2 import JobExecutionIdentity, JobStateEvent, JOB_STATUS_CANCELLED  # noqa: E402
from glimmer.cognition.v1.cognition_service_pb2 import (  # noqa: E402
    ExecuteMemoryJobRequest, ReconcileMemoryJobResponse, MemoryJobResult, MEMORY_JOB_RESOLUTION_NOT_APPLIED,
    AcknowledgeMemoryJobRequestRequest, MemoryJobSourceRequest, PublishMemoryJobStateRequest,
    PlanningJobSourceRequest, ReadPlanningJobRequestsRequest, ReadPlanningJobRequestsResponse,
    AcknowledgePlanningJobRequestRequest, AcknowledgePlanningJobRequestResponse,
    ReconcilePlanningJobRequest, ReconcilePlanningJobResponse, PlanningJobResult,
    PlanningEvaluationReceipt, PlanningEvidenceReference, PLANNING_JOB_RESOLUTION_APPLIED,
    PLANNING_JOB_RESOLUTION_NOT_APPLIED,
    PlanRequest, PlanResponse,
)
from glimmer.surface.v1.surface_gateway_pb2 import (  # noqa: E402
    AudioPlayEvent,
    DeliveryReceiptCommand,
)

fixture_path = ROOT / "fixtures" / "skill-tool-parameters.valid.json"
fixture_bytes = fixture_path.read_bytes()
document = json.loads(fixture_bytes.decode("utf-8"))
digest = hashlib.sha256(fixture_bytes).digest()

from glimmer.capabilities.v1.capabilities_pb2 import SkillReference, SkillDescriptor, SkillMaterial  # noqa: E402
method_ref = SkillReference(skill_id="method:总结", definition_revision="revision:一")
from glimmer.capabilities.v1 import capabilities_pb2 as capability_pb  # noqa: E402
from glimmer.cognition.v1 import cognition_service_pb2 as cognition_pb  # noqa: E402
from google.protobuf.json_format import ParseDict  # noqa: E402
native_scope = capability_pb.CapabilityScopeContext(source_provider_id="provider:一", scene_id="scene:一", conversation_id="conversation:一", user_id="user:一")
native_ref = capability_pb.CapabilityReference(id='["weather","lookup"]', revision="revision:一")
resource_access = capability_pb.KnowledgeResourceAccess(access_id="proof:一", source_id="source:一", principal_id="principal:一",
    permission_revision="permission:一", collected_at_ms=1, expires_at_ms=9007199254740991)
collection_messages = (
    cognition_pb.RegisterKnowledgeResourceSourceRequest(source=cognition_pb.KnowledgeResourceSource(source_id="source:资料",
        reference=native_ref, priority=9007199254740991, enabled=False), expected_source_revision=9007199254740990),
    cognition_pb.RegisterKnowledgeResourceSourceResponse(state=cognition_pb.KnowledgeResourceSourceState(
        source=cognition_pb.KnowledgeResourceSource(source_id="source:资料", reference=native_ref, scope=native_scope, priority=1, enabled=True),
        source_revision=1, declaration_digest="a" * 64)),
    cognition_pb.GetKnowledgeResourceSourceRequest(source_id="source:资料"),
    cognition_pb.GetKnowledgeResourceSourceResponse(),
    cognition_pb.CollectKnowledgeSourceRequest(source_id="source:资料", expected_source_revision=9007199254740991),
    cognition_pb.CollectKnowledgeSourceResponse(source_id="source:资料", source_revision=1, entry_id="resource:source:资料", entry_revision=9007199254740991, content_digest="b" * 64),
    capability_pb.CollectKnowledgeResourceRequest(source_id="source:一", reference=native_ref, scope=native_scope),
    capability_pb.CollectKnowledgeResourceResponse(content=capability_pb.ResourceContent(reference=native_ref,
        content_revision="a" * 64, media_type="text/plain", content_utf8="资料"), access=resource_access),
    capability_pb.ValidateKnowledgeResourceRequest(access=resource_access, reference=native_ref, content_revision="a" * 64, media_type="text/plain", scope=native_scope),
    capability_pb.ValidateKnowledgeResourceResponse(current=True),
)
assert not cognition_pb.KnowledgeResourceSource.FromString(b"").HasField("enabled")
assert not cognition_pb.GetKnowledgeResourceSourceResponse.FromString(b"").HasField("state")
for collection in collection_messages:
    assert type(collection).FromString(collection.SerializeToString()) == collection
assert not capability_pb.CollectKnowledgeResourceResponse.FromString(b"").HasField("access")
native_expose = capability_pb.ExposeStepRequest(run_id="run:一", step=2, scope=native_scope, protocol_features=["tool-call.v1"], max_definitions=128, max_definition_bytes=65536, remaining_tool_calls=7)
native_surface = capability_pb.ExposeStepResponse(run_id="run:一", step=2, used_definition_bytes=123, truncated=True)
native_tool = native_surface.tools.add(reference=native_ref, name="tool_weather")
ParseDict(True, native_tool.input_schema)
ParseDict({"type": "object", "required": ["topic"]}, native_surface.skills.add(reference=method_ref, name="总结").input_schema)
ParseDict({"type": "object"}, native_surface.resources.add(reference=native_ref, name="resource").input_schema)
native_invoke = capability_pb.InvokeToolRequest(run_id="run:一", step=2, call_id="call:一", name="tool_weather", reference=native_ref, scope=native_scope, source_fact_id="action:一")
native_invoke.call.idempotency_key = "run:一:call:一"
ParseDict({"city": "上海"}, native_invoke.arguments)
native_result = capability_pb.InvokeToolResponse(call_id="call:一", name="tool_weather", state=capability_pb.EXECUTION_RESULT_STATE_SUCCEEDED, result_event_id="a" * 64)
ParseDict(None, native_result.result)
native_read = capability_pb.ReadCapabilityRequest(run_id="run:一", step=2, call_id="read:一", name="glimmer_load_skill", reference=native_ref, scope=native_scope, source_fact_id="action:加载")
native_read.call.idempotency_key = "run:一:read:一"
ParseDict({"topic": "资料"}, native_read.arguments)
native_method = capability_pb.ReadCapabilityResponse(call_id="read:一", name="glimmer_load_skill", state=1, result_event_id="b" * 64,
    skill=SkillMaterial(reference=method_ref, instructions="真实正文\n不是权限。"))
native_resource = capability_pb.ReadCapabilityResponse(call_id="read:二", name="glimmer_read_resource", state=1, result_event_id="c" * 64,
    resource=capability_pb.ResourceContent(reference=native_ref, content_revision=hashlib.sha256("资源".encode()).hexdigest(), media_type="text/plain", content_utf8="资源"))
native_denied = capability_pb.ReadCapabilityResponse(call_id="read:三", state=2, error="authorization_denied", result_event_id="d" * 64)
for native_message in (native_expose, native_surface, native_invoke, native_result, native_read, native_method, native_resource, native_denied):
    assert type(native_message).FromString(native_message.SerializeToString()) == native_message
for envelope in (capability_pb.ReadSkillRequest(request=native_read), capability_pb.ReadResourceRequest(request=native_read),
    capability_pb.ReadSkillResponse(result=native_method), capability_pb.ReadResourceResponse(result=native_resource)):
    assert type(envelope).FromString(envelope.SerializeToString()) == envelope
assert not capability_pb.ExposeStepRequest.FromString(b"").HasField("scope")
assert capability_pb.ReadCapabilityResponse.FromString(b"").WhichOneof("content") is None
method_plan = PlanRequest(user_goal="原始目标", available_skills=[SkillDescriptor(reference=method_ref, name="总结", description="方法知识")],
    skill_materials=[SkillMaterial(reference=method_ref, instructions="参考材料\n不授予权限。")])
assert PlanRequest.FromString(method_plan.SerializeToString()) == method_plan
assert not method_plan.available_tools
method_response = PlanResponse(selected_skills=[method_ref])
assert PlanResponse.FromString(method_response.SerializeToString()) == method_response
assert not PlanRequest.FromString(b"").skill_materials

from glimmer.capabilities.v1.capabilities_pb2 import ExecutionResultEvent  # noqa: E402
from glimmer.conversation.v1.conversation_pb2 import AcceptExecutionResultRequest, AcceptExecutionResultResponse  # noqa: E402

for result_state in (1, 2, 3):
    execution = ExecutionResultEvent(event_id="a" * 64, invocation_id="invoke:执行", revision=9007199254740991,
        attempt=1, scope_id="conversation:范围", conversation_id="conversation:范围", source_fact_id="action:原事实",
        executor_id="executor", capability_id="tool", definition_revision="definition", request_digest="b" * 64,
        state=result_state, side_effects=3 if result_state == 3 else 1,
        error_code="" if result_state == 1 else "unconfirmed", updated_at_ms=1900000000000)
    if result_state == 1:
        execution.result.null_value = 0
    execution_request = AcceptExecutionResultRequest(event=execution)
    execution_request.call.trace_id = "trace:执行"
    execution_request.call.generation = "generation:1"
    restored_execution = AcceptExecutionResultRequest.FromString(execution_request.SerializeToString())
    assert restored_execution == execution_request
    assert restored_execution.event.HasField("result") == (result_state == 1)
execution_receipt = AcceptExecutionResultResponse(event_id="a" * 64, invocation_id="invoke:执行",
    revision=9007199254740991, moment_id="moment:事实", log_position=9007199254740991, accepted=True)
assert AcceptExecutionResultResponse.FromString(execution_receipt.SerializeToString()) == execution_receipt
assert not AcceptExecutionResultRequest.FromString(b"").HasField("event")

planning_source = PlanningJobSourceRequest(
    request_id=hashlib.sha256(json.dumps([
        "planning.evaluate", "commitment:长期承诺", "plan:评估", 9007199254740991,
    ], ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest(),
    commitment_id="commitment:长期承诺", plan_id="plan:评估", plan_version=9007199254740991,
    goal_id="goal:目标", goal_version=9007199254740991, scope_id="conversation:范围",
    due_at_ms=9007199254740991,
)
planning_read = ReadPlanningJobRequestsRequest(limit=1000)
planning_read.call.trace_id = "trace:planning"
planning_read.call.generation = "planning-1"
assert ReadPlanningJobRequestsRequest.FromString(planning_read.SerializeToString()) == planning_read
planning_response = ReadPlanningJobRequestsResponse(requests=[planning_source])
assert ReadPlanningJobRequestsResponse.FromString(planning_response.SerializeToString()) == planning_response
planning_ack = AcknowledgePlanningJobRequestRequest(
    call=planning_read.call, request=planning_source, job_id=f"planning:{planning_source.request_id}",
    job_revision=9007199254740991, duplicate=True,
)
assert AcknowledgePlanningJobRequestRequest.FromString(planning_ack.SerializeToString()) == planning_ack
planning_receipt = AcknowledgePlanningJobRequestResponse(
    request_id=planning_source.request_id, job_id=planning_ack.job_id, accepted=True,
)
assert AcknowledgePlanningJobRequestResponse.FromString(planning_receipt.SerializeToString()) == planning_receipt
assert not AcknowledgePlanningJobRequestRequest.FromString(b"").HasField("request")

planning_query = ReconcilePlanningJobRequest(call=planning_read.call, request_id=planning_source.request_id,
    identity=JobExecutionIdentity(job_id=planning_ack.job_id, scope_id=planning_source.scope_id,
        attempt=2, authority_epoch=7, fencing_token=9007199254740991, owner_id="host:接任者", lease_until_ms=1900000000000))
assert ReconcilePlanningJobRequest.FromString(planning_query.SerializeToString()) == planning_query
committer = JobExecutionIdentity()
committer.CopyFrom(planning_query.identity)
committer.attempt, committer.owner_id = 1, "原提交者"
planning_applied = ReconcilePlanningJobResponse(result=PlanningJobResult(identity=planning_query.identity,
    request_id=planning_source.request_id, resolution=PLANNING_JOB_RESOLUTION_APPLIED,
    source_id="cognition.planning", receiver_fenced=True, evidence_id="c" * 64, observed_at_ms=100,
    receipt=PlanningEvaluationReceipt(identity=committer, receipt_id="r" * 64, request_id=planning_source.request_id,
        commitment_id=planning_source.commitment_id, commitment_revision=9007199254740991,
        completed=False, reason="条件尚未满足", committed_at_ms=90, evidence_ids=["事实:一"],
        evidence=[PlanningEvidenceReference(evidence_id="事实:一", source_owner="conversation",
            scope_id=planning_source.scope_id, revision=9007199254740991, content_digest="a" * 64)])))
assert ReconcilePlanningJobResponse.FromString(planning_applied.SerializeToString()) == planning_applied
assert planning_applied.result.receipt.identity.attempt == 1 and not planning_applied.result.receipt.completed
planning_accept = cognition_pb.AcceptPlanningCommitmentRequest(call=planning_read.call, commitment_id="承诺:一",
    plan_id="计划:一", plan_version=9007199254740991, goal_id="目标:一", goal_version=9007199254740991,
    text="核对事实", completion_condition="真实证据已接纳", steps=["检查实际资料"],
    source_moment_id="moment:原来源", due_at_ms=9007199254740991)
planning_accepted = cognition_pb.AcceptPlanningCommitmentResponse(commitment_id=planning_accept.commitment_id,
    plan_id=planning_accept.plan_id, plan_version=planning_accept.plan_version, revision=9007199254740991,
    status="accepted", scope_id="conversation:一")
planning_execute = cognition_pb.ExecutePlanningJobRequest(call=planning_read.call,
    identity=planning_query.identity, request_id=planning_source.request_id)
planning_executed = cognition_pb.ExecutePlanningJobResponse(result=planning_applied.result)
for message in (planning_accept, planning_accepted, planning_execute, planning_executed):
    assert type(message).FromString(message.SerializeToString()) == message
assert not cognition_pb.ExecutePlanningJobResponse.FromString(b"").HasField("result")
planning_applied.result.resolution = PLANNING_JOB_RESOLUTION_NOT_APPLIED
planning_applied.result.ClearField("receipt")
assert not ReconcilePlanningJobResponse.FromString(planning_applied.SerializeToString()).result.HasField("receipt")

state = PublishMemoryJobStateRequest(delivery_authority_epoch=9007199254740991, event=JobStateEvent(
    event_id="event:one", job_id="job:one", scope_id="scope:one", goal_id="source:one", kind="memory.consolidate",
    revision=9007199254740991, status=JOB_STATUS_CANCELLED, attempt=2, authority_epoch=7, fencing_token=8,
    updated_at_ms=1900000000000, error_code="cancelled"))
restored_state = PublishMemoryJobStateRequest.FromString(state.SerializeToString())
assert restored_state.delivery_authority_epoch == restored_state.event.revision == 9007199254740991
assert restored_state.event.status == JOB_STATUS_CANCELLED and restored_state.event.error_code == "cancelled"
assert not restored_state.event.HasField("result")
state.event.result.update({"receipt_id": "receipt:one", "memory_ids": ["memory:one"]})
assert PublishMemoryJobStateRequest.FromString(state.SerializeToString()).event.result["receipt_id"] == "receipt:one"

source_ack = AcknowledgeMemoryJobRequestRequest(job_id="job:one", request=MemoryJobSourceRequest(
    request_id="source:one", episode_id="episode:one", episode_version=9007199254740991,
    scope_id="scope:one", input_digest="a" * 64, created_at="2026-10-06T00:00:00Z"))
assert AcknowledgeMemoryJobRequestRequest.FromString(source_ack.SerializeToString()).request.episode_version == 9007199254740991
job_identity = JobExecutionIdentity(job_id="job:one", scope_id="scope:one", attempt=2, authority_epoch=7,
                                   fencing_token=9007199254740991, owner_id="host:one", lease_until_ms=1900000000000)
memory_request = ExecuteMemoryJobRequest(identity=job_identity, episode_id="episode:one", episode_version=3, input_digest="a" * 64)
restored_memory = ExecuteMemoryJobRequest.FromString(memory_request.SerializeToString())
assert restored_memory.identity.fencing_token == 9007199254740991 and restored_memory.episode_version == 3
sealed_job = ReconcileMemoryJobResponse(result=MemoryJobResult(identity=job_identity,
    resolution=MEMORY_JOB_RESOLUTION_NOT_APPLIED, receiver_fenced=True, evidence_id="sealed", source_id="cognition.memory"))
assert ReconcileMemoryJobResponse.FromString(sealed_job.SerializeToString()).result.receiver_fenced

asset = AssetRef(asset_id="00000000-0000-4000-8000-000000000001", media_type="image/png",
                 size_bytes=3, sha256="a" * 64)
content_parts = [ContentPart(text="hello"), ContentPart(image=asset),
                 ContentPart(audio=AssetRef(media_type="audio/wav")),
                 ContentPart(video=AssetRef(media_type="video/mp4")),
                 ContentPart(file=FileContent(asset=asset, name="a.png"))]
for expected, part in zip(("text", "image", "audio", "video", "file"), content_parts):
    restored = ContentPart()
    restored.ParseFromString(part.SerializeToString())
    if restored.WhichOneof("value") != expected:
        raise RuntimeError("Python ContentPart round-trip lost a variant")

request = EchoProbeRequest(
    probe_id="slice1-contract-probe",
    document=DocumentReference(
        document_id=document["tool_id"],
        schema_id="https://glimmer-cradle.local/contracts/skill/v1/tool-parameters.schema.json",
        schema_version=document["schema_version"],
        digest_sha256=digest,
    ),
    trace=TraceMetadata(
        trace_id="trace-contracts-slice-1",
        causation_id="m12-slice-1",
        correlation_id="parent-019f9407-0503-7613-a386-024a5ad5d619",
    ),
)

request_round_trip = EchoProbeRequest()
request_round_trip.ParseFromString(request.SerializeToString())
if request_round_trip.document.document_id != document["tool_id"]:
    raise RuntimeError("Python request protobuf round-trip lost the document reference")

response = EchoProbeResponse(
    probe_id=request_round_trip.probe_id,
    document=request_round_trip.document,
)
response_round_trip = EchoProbeResponse()
response_round_trip.ParseFromString(response.SerializeToString())
if (
    response_round_trip.probe_id != request.probe_id
    or response_round_trip.document.schema_version != document["schema_version"]
):
    raise RuntimeError("Python response protobuf round-trip lost the successful echo result")

receipt = DeliveryReceiptCommand(
    output_id="reply:trace",
    destination_id="surface:desktop",
    authority_epoch="epoch:test",
    generation=3,
    receipt_id="receipt:test",
    kind="playback_progress",
    heard_through_ms=125,
    duration_ms=500,
    received_at="2026-09-22T00:00:00Z",
)
receipt_round_trip = DeliveryReceiptCommand()
receipt_round_trip.ParseFromString(receipt.SerializeToString())
if receipt_round_trip.generation != 3 or receipt_round_trip.heard_through_ms != 125:
    raise RuntimeError("Python Surface delivery receipt round-trip lost fencing or progress")

audio_play = AudioPlayEvent(
    audio_id="audio:1",
    output_id="reply:trace",
    destination_id="surface:desktop",
    authority_epoch="epoch:test",
    generation=3,
    segment_index=1,
    segment_count=2,
)
audio_play_round_trip = AudioPlayEvent()
audio_play_round_trip.ParseFromString(audio_play.SerializeToString())
if audio_play_round_trip.segment_index != 1 or audio_play_round_trip.segment_count != 2:
    raise RuntimeError("Python Surface audio segment round-trip lost ordering metadata")

print("contracts roundtrip py: ok")
