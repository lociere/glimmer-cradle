using GlimmerCradle.Avatar;
using GlimmerCradle.UnityAvatarHost.Adapters;
using Xunit;

namespace GlimmerCradle.UnityAvatarHost.Tests;

public sealed class AvatarContractAdapterTests
{
    [Fact]
    public void DownstreamMappingPreservesPublishedWireNamesAndIgnoresUnownedFields()
    {
        const string json = """
            {"kind":"avatar_intent","trace_id":"trace-1","timestamp":42,"avatar_intent":{"action_id":"wave-hand","operation":"trigger","source":"user","priority":7},"legacy_unowned":{"default":true}}
            """;
        var frame = AvatarContractAdapter.DeserializeDownstream(json);

        Assert.Equal("trace-1", frame.trace_id);
        Assert.Equal("wave-hand", frame.avatar_intent.action_id);
        Assert.Equal(7, frame.avatar_intent.priority);
    }

    [Fact]
    public void UpstreamMappingUsesSnakeCaseAndRoundTripsRepeatedFields()
    {
        var json = AvatarContractAdapter.SerializeUpstream(new AvatarUpstreamFrame
        {
            kind = "host_hello",
            trace_id = "trace-2",
            timestamp = 43,
            host_hello = new AvatarHostHelloPayload
            {
                host_kind = "unity",
                host_id = "host-1",
                capabilities = new[] { "motion", "avatar_intent" },
            },
        });

        Assert.Contains("\"trace_id\"", json);
        Assert.Contains("\"host_hello\"", json);
        Assert.Contains("\"host_kind\"", json);
        Assert.DoesNotContain("traceId", json);
        Assert.DoesNotContain("hostHello", json);
        Assert.Contains("avatar_intent", json);
    }
}
