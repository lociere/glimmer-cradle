using System;
using System.Collections.Generic;
using GlimmerCradle.Avatar;
using GlimmerCradle.UnityAvatarHost.Adapters;
using Xunit;
using Contract = GlimmerCradle.Contracts.Glimmer.Avatar.V1;

namespace GlimmerCradle.UnityAvatarHost.Tests;

public sealed class AvatarContractAdapterTests
{
    [Fact]
    public void ValidIntentMapsToTypedCoreCommandAndPreservesTraceAtEdge()
    {
        var frame = new Contract.AvatarDownstreamFrame
        {
            Kind = "avatar_intent",
            TraceId = "trace-1",
            Timestamp = 42,
            AvatarIntent = new Contract.AvatarIntentPayload
            {
                ActionId = "wave-hand",
                Operation = "trigger",
                Source = "user",
                Priority = 7,
            },
        };

        var result = AvatarContractAdapter.ReadDownstream(frame);

        Assert.True(result.IsSuccess);
        Assert.Equal("trace-1", result.Message.TraceId);
        var command = Assert.IsType<ExecuteAvatarActionCommand>(result.Message.Command);
        Assert.Equal("wave-hand", command.ActionId);
        Assert.Equal(AvatarActionOperation.Trigger, command.Operation);
        Assert.Equal(AvatarActionSource.User, command.Source);
        Assert.Equal(7, command.Priority);
    }

    public static IEnumerable<object[]> InvalidKindPayloadCases()
    {
        yield return new object[]
        {
            new Contract.AvatarDownstreamFrame { Kind = "extension_install", Timestamp = 1 },
            AvatarContractFailureCode.UnknownKind,
        };
        yield return new object[]
        {
            new Contract.AvatarDownstreamFrame { Kind = "expression", Timestamp = 1 },
            AvatarContractFailureCode.MissingPayload,
        };
        yield return new object[]
        {
            new Contract.AvatarDownstreamFrame
            {
                Kind = "expression",
                Timestamp = 1,
                Motion = new Contract.AvatarMotionPayload { MotionId = "wave" },
            },
            AvatarContractFailureCode.MismatchedPayload,
        };
        yield return new object[]
        {
            new Contract.AvatarDownstreamFrame
            {
                Kind = "expression",
                Timestamp = 1,
                Expression = new Contract.AvatarExpressionPayload { ExpressionId = "smile" },
                Motion = new Contract.AvatarMotionPayload { MotionId = "wave" },
            },
            AvatarContractFailureCode.MismatchedPayload,
        };
    }

    [Theory]
    [MemberData(nameof(InvalidKindPayloadCases))]
    public void InvalidKindPayloadMatrixFailsClosed(
        Contract.AvatarDownstreamFrame frame,
        AvatarContractFailureCode expected)
    {
        var result = AvatarContractAdapter.ReadDownstream(frame);

        Assert.False(result.IsSuccess);
        Assert.Equal(expected, result.Failure.Code);
        Assert.StartsWith("avatar_contract_", result.Failure.WireCode, StringComparison.Ordinal);
    }

    [Fact]
    public void UnknownSemanticEnumFailsClosed()
    {
        var frame = new Contract.AvatarDownstreamFrame
        {
            Kind = "avatar_intent",
            Timestamp = 1,
            AvatarIntent = new Contract.AvatarIntentPayload
            {
                ActionId = "wave",
                Operation = "toggle",
                Source = "user",
            },
        };

        var result = AvatarContractAdapter.ReadDownstream(frame);

        Assert.False(result.IsSuccess);
        Assert.Equal(AvatarContractFailureCode.UnknownEnum, result.Failure.Code);
    }

    [Fact]
    public void NullBinaryMessageFailsClosed()
    {
        var result = AvatarContractAdapter.ReadDownstream(null);

        Assert.False(result.IsSuccess);
        Assert.Equal(AvatarContractFailureCode.MalformedMessage, result.Failure.Code);
    }

    public static IEnumerable<object[]> MissingRequiredFieldCases()
    {
        yield return new object[]
        {
            new Contract.AvatarDownstreamFrame
            {
                Kind = "thought",
                Timestamp = 1,
                Thought = new Contract.ThoughtPayload(),
            },
        };
        yield return new object[]
        {
            new Contract.AvatarDownstreamFrame
            {
                Kind = "parameter",
                Timestamp = 1,
                Parameter = new Contract.AvatarParameterPayload { ParamId = "ParamAngleX" },
            },
        };
        yield return new object[]
        {
            new Contract.AvatarDownstreamFrame
            {
                Kind = "load_scene",
                Timestamp = 1,
                LoadScene = new Contract.LoadScenePayload(),
            },
        };
    }

    [Theory]
    [MemberData(nameof(MissingRequiredFieldCases))]
    public void MissingPublishedRequiredFieldFailsClosed(Contract.AvatarDownstreamFrame frame)
    {
        var result = AvatarContractAdapter.ReadDownstream(frame);

        Assert.False(result.IsSuccess);
        Assert.Equal(AvatarContractFailureCode.MissingRequiredField, result.Failure.Code);
    }

    [Fact]
    public void PingIsHandledAtTransportEdgeWithoutCreatingCoreCommand()
    {
        var result = AvatarContractAdapter.ReadDownstream(new Contract.AvatarDownstreamFrame
        {
            Kind = "ping",
            TraceId = "trace-ping",
            Timestamp = 1,
        });

        Assert.True(result.IsSuccess);
        Assert.True(result.Message.IsPing);
        Assert.Null(result.Message.Command);
        var pong = AvatarContractAdapter.MapPong(result.Message.TraceId, 2);
        Assert.Equal("pong", pong.Kind);
        Assert.Equal("trace-ping", pong.TraceId);
    }

    [Fact]
    public void UpstreamErrorMapsDirectlyToGeneratedDto()
    {
        var frame = AvatarContractAdapter.MapHostEvent(
            new AvatarHostFailed("avatar_contract_unknown_kind", "unknown kind"),
            "trace-error",
            43);

        Assert.Equal("error", frame.Kind);
        Assert.Equal("trace-error", frame.TraceId);
        Assert.Equal("avatar_contract_unknown_kind", frame.Error.Code);
        Assert.Equal("unknown kind", frame.Error.Message);
    }

    [Fact]
    public void UpstreamActionResultMapsTypedStateAndRepeatedIds()
    {
        var frame = AvatarContractAdapter.MapHostEvent(
            new AvatarActionStateChanged(
                "wave",
                AvatarActionExecutionState.Completed,
                new[] { "hat", "wave" },
                "done"),
            "trace-result",
            44);

        Assert.Equal("avatar_action_state", frame.Kind);
        Assert.Equal("completed", frame.AvatarActionState.State);
        Assert.Equal(new[] { "hat", "wave" }, frame.AvatarActionState.ActiveActionIds);
    }
}
