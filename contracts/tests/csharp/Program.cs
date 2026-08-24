using System;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using Google.Protobuf;
using GlimmerCradle.Contracts.Glimmer.Common.V1;
using GlimmerCradle.Contracts.Glimmer.Cognition.V1;
using GlimmerCradle.Contracts.Glimmer.Kernel.V1;
using AvatarV1 = GlimmerCradle.Contracts.Glimmer.Avatar.V1;

var root = Environment.GetEnvironmentVariable("CONTRACTS_ROOT")
    ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
var fixturePath = Path.Combine(root, "fixtures", "skill-tool-parameters.valid.json");
var fixtureBytes = File.ReadAllBytes(fixturePath);
using var documentJson = JsonDocument.Parse(fixtureBytes);
var document = documentJson.RootElement;
var digest = SHA256.HashData(fixtureBytes);

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

Console.WriteLine("contracts roundtrip cs: ok");
