using System;
using GlimmerCradle.Avatar;
using GlimmerCradle.UnityAvatarHost.Adapters;
using Xunit;

namespace GlimmerCradle.UnityAvatarHost.Tests;

public sealed class AvatarContractAdapterTests
{
    [Fact]
    public void ValidIntentMapsToTypedCoreCommandAndPreservesTraceAtEdge()
    {
        const string json = """
            {"kind":"avatar_intent","trace_id":"trace-1","timestamp":42,"avatar_intent":{"action_id":"wave-hand","operation":"trigger","source":"user","priority":7}}
            """;

        var result = AvatarContractAdapter.ParseDownstream(json);

        Assert.True(result.IsSuccess);
        Assert.Equal("trace-1", result.Message.TraceId);
        var command = Assert.IsType<ExecuteAvatarActionCommand>(result.Message.Command);
        Assert.Equal("wave-hand", command.ActionId);
        Assert.Equal(AvatarActionOperation.Trigger, command.Operation);
        Assert.Equal(AvatarActionSource.User, command.Source);
        Assert.Equal(7, command.Priority);
    }

    [Theory]
    [InlineData("{\"kind\":\"extension_install\",\"timestamp\":1}", AvatarContractFailureCode.UnknownKind)]
    [InlineData("{\"kind\":\"expression\",\"timestamp\":1}", AvatarContractFailureCode.MissingPayload)]
    [InlineData("{\"kind\":\"expression\",\"timestamp\":1,\"motion\":{\"motion_id\":\"wave\"}}", AvatarContractFailureCode.MismatchedPayload)]
    [InlineData("{\"kind\":\"expression\",\"timestamp\":1,\"expression\":{\"expression_id\":\"smile\"},\"motion\":{\"motion_id\":\"wave\"}}", AvatarContractFailureCode.MismatchedPayload)]
    public void InvalidKindPayloadMatrixFailsClosed(string json, AvatarContractFailureCode expected)
    {
        var result = AvatarContractAdapter.ParseDownstream(json);

        Assert.False(result.IsSuccess);
        Assert.Equal(expected, result.Failure.Code);
        Assert.StartsWith("avatar_contract_", result.Failure.WireCode, StringComparison.Ordinal);
    }

    [Fact]
    public void UnknownSemanticEnumFailsClosed()
    {
        const string json = """
            {"kind":"avatar_intent","timestamp":1,"avatar_intent":{"action_id":"wave","operation":"toggle","source":"user"}}
            """;

        var result = AvatarContractAdapter.ParseDownstream(json);

        Assert.False(result.IsSuccess);
        Assert.Equal(AvatarContractFailureCode.UnknownEnum, result.Failure.Code);
    }

    [Theory]
    [InlineData("{not-json")]
    [InlineData("{\"kind\":\"idle\",\"timestamp\":1,\"legacy_unowned\":true}")]
    public void MalformedOrUnknownJsonFieldFailsClosed(string json)
    {
        var result = AvatarContractAdapter.ParseDownstream(json);

        Assert.False(result.IsSuccess);
        Assert.Equal(AvatarContractFailureCode.MalformedJson, result.Failure.Code);
    }

    [Theory]
    [InlineData("{\"kind\":\"thought\",\"timestamp\":1,\"thought\":{}}")]
    [InlineData("{\"kind\":\"parameter\",\"timestamp\":1,\"parameter\":{\"param_id\":\"ParamAngleX\"}}")]
    [InlineData("{\"kind\":\"load_scene\",\"timestamp\":1,\"load_scene\":{}}")]
    public void MissingPublishedRequiredFieldFailsClosed(string json)
    {
        var result = AvatarContractAdapter.ParseDownstream(json);

        Assert.False(result.IsSuccess);
        Assert.Equal(AvatarContractFailureCode.MissingRequiredField, result.Failure.Code);
    }

    [Fact]
    public void PingIsHandledAtTransportEdgeWithoutCreatingCoreCommand()
    {
        var result = AvatarContractAdapter.ParseDownstream("{\"kind\":\"ping\",\"trace_id\":\"trace-ping\",\"timestamp\":1}");

        Assert.True(result.IsSuccess);
        Assert.True(result.Message.IsPing);
        Assert.Null(result.Message.Command);
        Assert.Contains("\"kind\": \"pong\"", AvatarContractAdapter.SerializePong(result.Message.TraceId, 2));
    }

    [Fact]
    public void UpstreamErrorUsesPublishedSnakeCaseWireShape()
    {
        var json = AvatarContractAdapter.SerializeHostEvent(
            new AvatarHostFailed("avatar_contract_unknown_kind", "unknown kind"),
            "trace-error",
            43);

        Assert.Contains("\"kind\": \"error\"", json);
        Assert.Contains("\"trace_id\": \"trace-error\"", json);
        Assert.Contains("\"error\"", json);
        Assert.Contains("\"code\": \"avatar_contract_unknown_kind\"", json);
        Assert.DoesNotContain("traceId", json);
    }

    [Fact]
    public void UpstreamActionResultMapsTypedStateAndRepeatedIds()
    {
        var json = AvatarContractAdapter.SerializeHostEvent(
            new AvatarActionStateChanged(
                "wave",
                AvatarActionExecutionState.Completed,
                new[] { "hat", "wave" },
                "done"),
            "trace-result",
            44);

        Assert.Contains("\"kind\": \"avatar_action_state\"", json);
        Assert.Contains("\"active_action_ids\"", json);
        Assert.Contains("\"completed\"", json);
        Assert.Contains("\"hat\"", json);
        Assert.Contains("\"wave\"", json);
    }
}
