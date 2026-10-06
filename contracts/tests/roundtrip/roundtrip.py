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
from glimmer.jobs.v1.jobs_pb2 import JobExecutionIdentity  # noqa: E402
from glimmer.cognition.v1.cognition_service_pb2 import (  # noqa: E402
    ExecuteMemoryJobRequest, ReconcileMemoryJobResponse, MemoryJobResult, MEMORY_JOB_RESOLUTION_NOT_APPLIED,
    AcknowledgeMemoryJobRequestRequest, MemoryJobSourceRequest,
)
from glimmer.surface.v1.surface_gateway_pb2 import (  # noqa: E402
    AudioPlayEvent,
    DeliveryReceiptCommand,
)

fixture_path = ROOT / "fixtures" / "skill-tool-parameters.valid.json"
fixture_bytes = fixture_path.read_bytes()
document = json.loads(fixture_bytes.decode("utf-8"))
digest = hashlib.sha256(fixture_bytes).digest()

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
