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

fixture_path = ROOT / "fixtures" / "skill-tool-parameters.valid.json"
fixture_bytes = fixture_path.read_bytes()
document = json.loads(fixture_bytes.decode("utf-8"))
digest = hashlib.sha256(fixture_bytes).digest()

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

print("contracts roundtrip py: ok")
