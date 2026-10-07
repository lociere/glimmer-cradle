using System;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using Google.Protobuf;
using GlimmerCradle.Contracts.Glimmer.Common.V1;
using GlimmerCradle.Contracts.Glimmer.Cognition.V1;
using GlimmerCradle.Contracts.Glimmer.Kernel.V1;
using AvatarV1 = GlimmerCradle.Contracts.Glimmer.Avatar.V1;
using ContentV1 = GlimmerCradle.Contracts.Glimmer.Content.V1;
using SurfaceV1 = GlimmerCradle.Contracts.Glimmer.Surface.V1;
using JobsV1 = GlimmerCradle.Contracts.Glimmer.Jobs.V1;

var root = Environment.GetEnvironmentVariable("CONTRACTS_ROOT")
    ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
var fixturePath = Path.Combine(root, "fixtures", "skill-tool-parameters.valid.json");
var fixtureBytes = File.ReadAllBytes(fixturePath);
using var documentJson = JsonDocument.Parse(fixtureBytes);
var document = documentJson.RootElement;
var digest = SHA256.HashData(fixtureBytes);

var planningSource = new PlanningJobSourceRequest {
    RequestId = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(
        "[\"planning.evaluate\",\"commitment:长期承诺\",\"plan:评估\",9007199254740991]"))).ToLowerInvariant(),
    CommitmentId = "commitment:长期承诺", PlanId = "plan:评估", PlanVersion = 9007199254740991,
    GoalId = "goal:目标", GoalVersion = 9007199254740991, ScopeId = "conversation:范围",
    DueAtMs = 9007199254740991,
};
var planningRead = new ReadPlanningJobRequestsRequest {
    Call = new CallMetadata { TraceId = "trace:planning", Generation = "planning-1" }, Limit = 1000,
};
if (!ReadPlanningJobRequestsRequest.Parser.ParseFrom(planningRead.ToByteArray()).Equals(planningRead))
    throw new InvalidOperationException("Planning source read metadata roundtrip failed");
var planningResponse = new ReadPlanningJobRequestsResponse { Requests = { planningSource } };
if (!ReadPlanningJobRequestsResponse.Parser.ParseFrom(planningResponse.ToByteArray()).Equals(planningResponse))
    throw new InvalidOperationException("Planning source identity/precision roundtrip failed");
var planningAck = new AcknowledgePlanningJobRequestRequest {
    Call = planningRead.Call, Request = planningSource, JobId = "planning:" + planningSource.RequestId,
    JobRevision = 9007199254740991, Duplicate = true,
};
if (!AcknowledgePlanningJobRequestRequest.Parser.ParseFrom(planningAck.ToByteArray()).Equals(planningAck))
    throw new InvalidOperationException("Planning source ACK precision/metadata roundtrip failed");
var planningReceipt = new AcknowledgePlanningJobRequestResponse {
    RequestId = planningSource.RequestId, JobId = planningAck.JobId, Accepted = true,
};
if (!AcknowledgePlanningJobRequestResponse.Parser.ParseFrom(planningReceipt.ToByteArray()).Equals(planningReceipt))
    throw new InvalidOperationException("Planning source receipt roundtrip failed");
if (AcknowledgePlanningJobRequestRequest.Parser.ParseFrom(Array.Empty<byte>()).Request != null)
    throw new InvalidOperationException("Planning source ACK absent request gained presence");

var stateRequest = new PublishMemoryJobStateRequest { DeliveryAuthorityEpoch = 9007199254740991,
    Event = new JobsV1.JobStateEvent { EventId = "event:one", JobId = "job:one", ScopeId = "scope:one",
        GoalId = "source:one", Kind = "memory.consolidate", Revision = 9007199254740991,
        Status = JobsV1.JobStatus.Cancelled, Attempt = 2, AuthorityEpoch = 7, FencingToken = 8,
        UpdatedAtMs = 1900000000000, ErrorCode = "cancelled" } };
var restoredState = PublishMemoryJobStateRequest.Parser.ParseFrom(stateRequest.ToByteArray());
if (restoredState.DeliveryAuthorityEpoch != 9007199254740991 || restoredState.Event.Revision != 9007199254740991
    || restoredState.Event.Status != JobsV1.JobStatus.Cancelled || restoredState.Event.Result != null
    || !restoredState.Event.HasErrorCode || restoredState.Event.ErrorCode != "cancelled")
    throw new InvalidOperationException("Job state precision/presence roundtrip failed");
stateRequest.Event.Result = Google.Protobuf.WellKnownTypes.Struct.Parser.ParseJson("{\"receipt_id\":\"receipt:one\",\"memory_ids\":[\"memory:one\"]}");
if (PublishMemoryJobStateRequest.Parser.ParseFrom(stateRequest.ToByteArray()).Event.Result.Fields["receipt_id"].StringValue != "receipt:one")
    throw new InvalidOperationException("Job state result roundtrip failed");

var sourceAck = new AcknowledgeMemoryJobRequestRequest { JobId = "job:one", Request = new MemoryJobSourceRequest {
    RequestId = "source:one", EpisodeId = "episode:one", EpisodeVersion = 9007199254740991,
    ScopeId = "scope:one", InputDigest = new string('a', 64), CreatedAt = "2026-10-06T00:00:00Z" } };
if (AcknowledgeMemoryJobRequestRequest.Parser.ParseFrom(sourceAck.ToByteArray()).Request.EpisodeVersion != 9007199254740991)
    throw new InvalidOperationException("Memory source request roundtrip failed");
var jobIdentity = new JobsV1.JobExecutionIdentity { JobId = "job:one", ScopeId = "scope:one", Attempt = 2,
    AuthorityEpoch = 7, FencingToken = 9007199254740991, OwnerId = "host:one", LeaseUntilMs = 1900000000000 };
var memoryRequest = new ExecuteMemoryJobRequest { Identity = jobIdentity, EpisodeId = "episode:one",
    EpisodeVersion = 3, InputDigest = new string('a', 64) };
var restoredMemory = ExecuteMemoryJobRequest.Parser.ParseFrom(memoryRequest.ToByteArray());
if (restoredMemory.Identity.FencingToken != jobIdentity.FencingToken || restoredMemory.EpisodeVersion != 3)
    throw new InvalidOperationException("Memory Job original identity round-trip lost precision");
var sealedJob = new ReconcileMemoryJobResponse { Result = new MemoryJobResult { Identity = jobIdentity,
    Resolution = MemoryJobResolution.NotApplied, ReceiverFenced = true, EvidenceId = "sealed", SourceId = "cognition.memory" } };
if (!ReconcileMemoryJobResponse.Parser.ParseFrom(sealedJob.ToByteArray()).Result.ReceiverFenced)
    throw new InvalidOperationException("Memory Job sealed proof round-trip lost fencing");

var contentAsset = new ContentV1.AssetRef
{
    AssetId = "00000000-0000-4000-8000-000000000001", MediaType = "image/png",
    SizeBytes = 3, Sha256 = new string('a', 64),
};
var contentParts = new[]
{
    new ContentV1.ContentPart { Text = "hello" },
    new ContentV1.ContentPart { Image = contentAsset },
    new ContentV1.ContentPart { Audio = contentAsset },
    new ContentV1.ContentPart { Video = contentAsset },
    new ContentV1.ContentPart { File = new ContentV1.FileContent { Asset = contentAsset, Name = "a.png" } },
};
var contentCases = new[] { ContentV1.ContentPart.ValueOneofCase.Text, ContentV1.ContentPart.ValueOneofCase.Image,
    ContentV1.ContentPart.ValueOneofCase.Audio, ContentV1.ContentPart.ValueOneofCase.Video,
    ContentV1.ContentPart.ValueOneofCase.File };
for (var index = 0; index < contentParts.Length; index++)
{
    var restored = ContentV1.ContentPart.Parser.ParseFrom(contentParts[index].ToByteArray());
    if (restored.ValueCase != contentCases[index])
        throw new InvalidOperationException("C# ContentPart round-trip lost a variant");
}

var request = new EchoProbeRequest
{
    ProbeId = "slice1-contract-probe",
    Document = new DocumentReference
    {
        DocumentId = document.GetProperty("tool_id").GetString(),
        SchemaId = "https://glimmer-cradle.local/contracts/skill/v1/tool-parameters.schema.json",
        SchemaVersion = document.GetProperty("schema_version").GetString(),
        DigestSha256 = Google.Protobuf.ByteString.CopyFrom(digest),
    },
    Trace = new TraceMetadata
    {
        TraceId = "trace-contracts-slice-1",
        CausationId = "m12-slice-1",
        CorrelationId = "parent-019f9407-0503-7613-a386-024a5ad5d619",
    },
};

var requestRoundTrip = EchoProbeRequest.Parser.ParseFrom(request.ToByteArray());
if (requestRoundTrip.Document.DocumentId != document.GetProperty("tool_id").GetString())
{
    throw new InvalidOperationException("C# request protobuf round-trip lost the document reference");
}

var response = new EchoProbeResponse
{
    ProbeId = requestRoundTrip.ProbeId,
    Document = requestRoundTrip.Document,
};
var responseRoundTrip = EchoProbeResponse.Parser.ParseFrom(response.ToByteArray());
if (responseRoundTrip.ProbeId != request.ProbeId
    || responseRoundTrip.Document.SchemaVersion != document.GetProperty("schema_version").GetString())
{
    throw new InvalidOperationException("C# response protobuf round-trip lost the successful echo result");
}

var registration = new RegisterCognitionRequest
{
    Call = new CallMetadata { TraceId = "trace-register", Generation = "generation-1" },
    Endpoint = "grpc://127.0.0.1:43123",
    ProcessId = 42,
    RegistrationNonce = "nonce-1",
    AuthProof = ByteString.CopyFrom(new byte[32]),
};
var registrationRoundTrip = RegisterCognitionRequest.Parser.ParseFrom(registration.ToByteArray());
if (registrationRoundTrip.RegistrationNonce != "nonce-1" || registrationRoundTrip.AuthProof.Length != 32)
{
    throw new InvalidOperationException("C# KernelControlService registration contract round-trip failed");
}

var perception = new SubmitPerceptionResponse
{
    OperationId = "perception-1",
    State = PerceptionOperationState.Accepted,
};
var perceptionRoundTrip = SubmitPerceptionResponse.Parser.ParseFrom(perception.ToByteArray());
if (perceptionRoundTrip.State != PerceptionOperationState.Accepted)
{
    throw new InvalidOperationException("C# CognitionService operation contract round-trip failed");
}

var avatarFrame = new AvatarV1.AvatarDownstreamFrame
{
    Kind = "avatar_intent",
    TraceId = "trace-avatar-contract",
    Timestamp = 42,
    AvatarIntent = new AvatarV1.AvatarIntentPayload
    {
        ActionId = "wave-hand",
        Operation = "trigger",
        Source = "user",
        Priority = 7,
    },
};
var avatarJsonFormatter = new JsonFormatter(
    JsonFormatter.Settings.Default.WithPreserveProtoFieldNames(true));
var avatarJson = avatarJsonFormatter.Format(avatarFrame);
if (!avatarJson.Contains("\"trace_id\"", StringComparison.Ordinal)
    || !avatarJson.Contains("\"avatar_intent\"", StringComparison.Ordinal)
    || !avatarJson.Contains("\"action_id\"", StringComparison.Ordinal)
    || avatarJson.Contains("traceId", StringComparison.Ordinal)
    || avatarJson.Contains("avatarIntent", StringComparison.Ordinal))
{
    throw new InvalidOperationException("C# Avatar JSON projection did not preserve published snake_case wire names");
}
var avatarJsonRoundTrip = AvatarV1.AvatarDownstreamFrame.Parser.ParseJson(avatarJson);
if (avatarJsonRoundTrip.AvatarIntent.ActionId != "wave-hand"
    || avatarJsonRoundTrip.AvatarIntent.Priority != 7)
{
    throw new InvalidOperationException("C# Avatar JSON round-trip lost the control payload");
}

var receipt = new SurfaceV1.DeliveryReceiptCommand
{
    OutputId = "reply:trace", DestinationId = "surface:desktop", AuthorityEpoch = "epoch:test",
    Generation = 3, ReceiptId = "receipt:test", Kind = "playback_progress",
    HeardThroughMs = 125, DurationMs = 500, ReceivedAt = "2026-09-22T00:00:00Z",
};
var receiptRoundTrip = SurfaceV1.DeliveryReceiptCommand.Parser.ParseFrom(receipt.ToByteArray());
if (receiptRoundTrip.Generation != 3 || receiptRoundTrip.HeardThroughMs != 125)
{
    throw new InvalidOperationException("C# Surface delivery receipt round-trip lost fencing or progress");
}
var audioPlay = new SurfaceV1.AudioPlayEvent
{
    AudioId = "audio:1", OutputId = "reply:trace", DestinationId = "surface:desktop",
    AuthorityEpoch = "epoch:test", Generation = 3, SegmentIndex = 1, SegmentCount = 2,
};
var audioPlayRoundTrip = SurfaceV1.AudioPlayEvent.Parser.ParseFrom(audioPlay.ToByteArray());
if (audioPlayRoundTrip.SegmentIndex != 1 || audioPlayRoundTrip.SegmentCount != 2)
{
    throw new InvalidOperationException("C# Surface audio segment round-trip lost ordering metadata");
}

Console.WriteLine("contracts roundtrip cs: ok");
