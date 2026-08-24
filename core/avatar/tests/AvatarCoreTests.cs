using System;
using System.Linq;
using Xunit;

namespace GlimmerCradle.Avatar.Tests;

public sealed class AvatarCoreTests
{
    [Fact]
    public void BehaviorProfileClampsWithoutUnity()
    {
        var profile = AvatarBehaviorProfile.FromDocument(new AvatarBehaviorDocument
        {
            gaze = new AvatarGazeProfile { responseTimeSeconds = -1, targetRange = 9 },
        });

        Assert.Equal(0.04f, profile.gaze.responseTimeSeconds);
        Assert.Equal(4f, profile.gaze.targetRange);
    }

    [Fact]
    public void CommandDispatcherRoutesByClosedCommandType()
    {
        var sink = new RecordingCommandSink();
        var command = new SetAvatarExpressionCommand("smile");

        AvatarCommandDispatcher.Dispatch(command, sink);

        Assert.Same(command, sink.Expression);
    }

    [Fact]
    public void CoreControlModelDoesNotMirrorWireEnvelopesOrSnakeCasePayloads()
    {
        var exported = typeof(AvatarCommand).Assembly.GetExportedTypes();

        Assert.DoesNotContain(exported, value => value.Name.Contains("Frame", StringComparison.Ordinal));
        Assert.DoesNotContain(exported, value => value.Name.EndsWith("Payload", StringComparison.Ordinal));
        Assert.DoesNotContain(
            exported.SelectMany(value => value.GetProperties()),
            value => value.Name.Contains("_", StringComparison.Ordinal) || value.Name == "Kind" || value.Name == "TraceId" || value.Name == "Timestamp");
    }

    [Fact]
    public void CoreAssemblyHasNoUnityGrpcGeneratedOrTransportDependency()
    {
        var references = typeof(AvatarCommandDispatcher).Assembly.GetReferencedAssemblies().Select(value => value.Name).ToArray();
        Assert.DoesNotContain(references, value => value!.StartsWith("Unity", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(references, value => value!.Contains("Grpc", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(references, value => value!.Contains("Protobuf", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(references, value => value!.Contains("Contracts", StringComparison.OrdinalIgnoreCase));
    }

    private sealed class RecordingCommandSink : IAvatarCommandSink
    {
        public SetAvatarExpressionCommand Expression { get; private set; }

        public void Shutdown(ShutdownAvatarCommand command) { }
        public void ApplyEmotion(SetAvatarEmotionCommand command) { }
        public void ApplyExpression(SetAvatarExpressionCommand command) => Expression = command;
        public void PlayMotion(PlayAvatarMotionCommand command) { }
        public void ApplyLipSync(SetAvatarLipSyncCommand command) { }
        public void ApplyParameter(SetAvatarParameterCommand command) { }
        public void ApplyIntent(ExecuteAvatarActionCommand command) { }
        public void ApplyPresentation(SetAvatarPresentationCommand command) { }
        public void ApplyCharacterPresentation(ApplyCharacterPresentationCommand command) { }
        public void PlayAudio(PlayAvatarAudioCommand command) { }
        public void ApplyThought(SetAvatarThoughtCommand command) { }
        public void PlayIdle(PlayIdleAvatarCommand command) { }
        public void LoadScene(LoadAvatarSceneCommand command) { }
        public void UnloadScene(UnloadAvatarSceneCommand command) { }
    }
}
