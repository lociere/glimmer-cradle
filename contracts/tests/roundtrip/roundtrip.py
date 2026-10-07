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
)
from glimmer.surface.v1.surface_gateway_pb2 import (  # noqa: E402
    AudioPlayEvent,
    DeliveryReceiptCommand,
)

fixture_path = ROOT / "fixtures" / "skill-tool-parameters.valid.json"
fixture_bytes = fixture_path.read_bytes()
document = json.loads(fixture_bytes.decode("utf-8"))
digest = hashlib.sha256(fixture_bytes).digest()

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
