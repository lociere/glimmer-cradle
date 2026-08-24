using System;

namespace GlimmerCradle.Avatar
{
    public abstract class AvatarCommand
    {
        internal AvatarCommand() { }
    }

    public sealed class ShutdownAvatarCommand : AvatarCommand { }
    public sealed class PlayIdleAvatarCommand : AvatarCommand { }
    public sealed class UnloadAvatarSceneCommand : AvatarCommand { }

    public sealed class SetAvatarEmotionCommand : AvatarCommand
    {
        public SetAvatarEmotionCommand(string emotionType, float intensity)
        {
            EmotionType = emotionType ?? throw new ArgumentNullException(nameof(emotionType));
            Intensity = intensity;
        }

        public string EmotionType { get; }
        public float Intensity { get; }
    }

    public sealed class SetAvatarThoughtCommand : AvatarCommand
    {
        public SetAvatarThoughtCommand(bool active) => Active = active;
        public bool Active { get; }
    }

    public sealed class PlayAvatarAudioCommand : AvatarCommand
    {
        public PlayAvatarAudioCommand(string audioId, string audioUri, string audioData)
        {
            AudioId = audioId ?? throw new ArgumentNullException(nameof(audioId));
            AudioUri = audioUri ?? string.Empty;
            AudioData = audioData ?? string.Empty;
        }

        public string AudioId { get; }
        public string AudioUri { get; }
        public string AudioData { get; }
    }

    public sealed class SetAvatarExpressionCommand : AvatarCommand
    {
        public SetAvatarExpressionCommand(string expressionId) =>
            ExpressionId = expressionId ?? throw new ArgumentNullException(nameof(expressionId));

        public string ExpressionId { get; }
    }

    public sealed class PlayAvatarMotionCommand : AvatarCommand
    {
        public PlayAvatarMotionCommand(string motionId, bool loop, int priority)
        {
            MotionId = motionId ?? throw new ArgumentNullException(nameof(motionId));
            Loop = loop;
            Priority = priority;
        }

        public string MotionId { get; }
        public bool Loop { get; }
        public int Priority { get; }
    }

    public sealed class SetAvatarLipSyncCommand : AvatarCommand
    {
        public SetAvatarLipSyncCommand(float amplitude) => Amplitude = amplitude;
        public float Amplitude { get; }
    }

    public sealed class SetAvatarParameterCommand : AvatarCommand
    {
        public SetAvatarParameterCommand(string parameterId, float value)
        {
            ParameterId = parameterId ?? throw new ArgumentNullException(nameof(parameterId));
            Value = value;
        }

        public string ParameterId { get; }
        public float Value { get; }
    }

    public enum AvatarActionOperation
    {
        Trigger,
        Activate,
        Deactivate,
    }

    public enum AvatarActionSource
    {
        User,
        Cognition,
        System,
        Extension,
    }

    public sealed class ExecuteAvatarActionCommand : AvatarCommand
    {
        public ExecuteAvatarActionCommand(
            string actionId,
            AvatarActionOperation operation,
            AvatarActionSource source,
            int priority)
        {
            ActionId = actionId ?? throw new ArgumentNullException(nameof(actionId));
            Operation = operation;
            Source = source;
            Priority = priority;
        }

        public string ActionId { get; }
        public AvatarActionOperation Operation { get; }
        public AvatarActionSource Source { get; }
        public int Priority { get; }
    }

    public sealed class SetAvatarPresentationCommand : AvatarCommand
    {
        public SetAvatarPresentationCommand(string placementId, float displayScale, bool resetPlacement)
        {
            PlacementId = placementId ?? string.Empty;
            DisplayScale = displayScale;
            ResetPlacement = resetPlacement;
        }

        public string PlacementId { get; }
        public float DisplayScale { get; }
        public bool ResetPlacement { get; }
    }

    public sealed class ApplyCharacterPresentationCommand : AvatarCommand
    {
        public ApplyCharacterPresentationCommand(string placementId, float displayScale)
        {
            PlacementId = placementId ?? string.Empty;
            DisplayScale = displayScale;
        }

        public string PlacementId { get; }
        public float DisplayScale { get; }
    }

    public sealed class LoadAvatarSceneCommand : AvatarCommand
    {
        public LoadAvatarSceneCommand(string sceneId) =>
            SceneId = sceneId ?? throw new ArgumentNullException(nameof(sceneId));

        public string SceneId { get; }
    }
}
