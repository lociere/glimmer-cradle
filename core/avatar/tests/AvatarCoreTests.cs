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
    public void FrameClassifierRejectsUnknownTransportInput()
    {
        Assert.True(AvatarFrameClassifier.IsSupported(new AvatarDownstreamFrame { kind = "emotion" }));
        Assert.False(AvatarFrameClassifier.IsSupported(new AvatarDownstreamFrame { kind = "extension_install" }));
    }

    [Fact]
    public void FrameDispatcherRoutesThroughCorePort()
    {
        var sink = new RecordingCommandSink();
        var payload = new AvatarExpressionPayload { expression_id = "smile" };

        Assert.True(AvatarFrameDispatcher.TryDispatch(
            new AvatarDownstreamFrame { kind = "expression", expression = payload },
            sink
        ));
        Assert.Same(payload, sink.Expression);
        Assert.False(AvatarFrameDispatcher.TryDispatch(
            new AvatarDownstreamFrame { kind = "extension_install" },
            sink
        ));
    }

    [Fact]
    public void CoreAssemblyHasNoUnityGrpcGeneratedOrTransportDependency()
    {
        var references = typeof(AvatarFrameClassifier).Assembly.GetReferencedAssemblies().Select(value => value.Name).ToArray();
        Assert.DoesNotContain(references, value => value!.StartsWith("Unity", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(references, value => value!.Contains("Grpc", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(references, value => value!.Contains("Protobuf", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(references, value => value!.Contains("Contracts", StringComparison.OrdinalIgnoreCase));
    }

    private sealed class RecordingCommandSink : IAvatarCommandSink
    {
        public AvatarExpressionPayload Expression { get; private set; }

        public void Shutdown() { }
        public void ApplyEmotion(EmotionPayload payload) { }
        public void ApplyExpression(AvatarExpressionPayload payload) => Expression = payload;
        public void PlayMotion(AvatarMotionPayload payload) { }
        public void ApplyLipSync(AvatarLipSyncPayload payload) { }
        public void ApplyParameter(AvatarParameterPayload payload) { }
        public void ApplyIntent(AvatarIntentPayload payload) { }
        public void ApplyPresentation(AvatarPresentationPayload payload) { }
        public void ApplyCharacterPresentation(CharacterPresentationProjectionPayload payload) { }
        public void PlayAudio(AudioPlayPayload payload) { }
        public void ApplyThought(ThoughtPayload payload) { }
        public void PlayIdle() { }
        public void LoadScene(LoadScenePayload payload) { }
        public void UnloadScene(UnloadScenePayload payload) { }
    }
}
