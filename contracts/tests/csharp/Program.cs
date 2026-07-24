using System;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using Google.Protobuf;
using GlimmerCradle.Contracts.Glimmer.Common.V1;

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
    Status = "ok",
};
var responseRoundTrip = EchoProbeResponse.Parser.ParseFrom(response.ToByteArray());
if (responseRoundTrip.Status != "ok"
    || responseRoundTrip.Document.SchemaVersion != document.GetProperty("schema_version").GetString())
{
    throw new InvalidOperationException("C# response protobuf round-trip lost the service status or schema version");
}

Console.WriteLine("contracts roundtrip cs: ok");
