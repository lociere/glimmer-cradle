using System;
using System.Collections.Generic;

namespace GlimmerCradle.Avatar
{
    public abstract class AvatarHostEvent
    {
        internal AvatarHostEvent() { }
    }

    public enum AvatarHostCapability
    {
        Expression,
        Motion,
        AvatarIntent,
        LipSync,
        Parameter,
        AudioPlay,
        LoadScene,
    }

    public enum AvatarWorkerWindowState
    {
        Isolated,
        Visible,
        Unknown,
    }

    public enum AvatarCompositionSurfaceState
    {
        Attached,
        Failed,
        Unknown,
    }

    public enum AvatarActionExecutionState
    {
        Inactive,
        Active,
        Running,
        Completed,
        Rejected,
    }

    public sealed class AvatarHostStarted : AvatarHostEvent
    {
        public AvatarHostStarted(string hostId, string hostVersion, string modelId, string avatarPackageId, IReadOnlyList<AvatarHostCapability> capabilities)
        {
            HostId = hostId ?? string.Empty;
            HostVersion = hostVersion ?? string.Empty;
            ModelId = modelId ?? string.Empty;
            AvatarPackageId = avatarPackageId ?? string.Empty;
            Capabilities = capabilities ?? throw new ArgumentNullException(nameof(capabilities));
        }

        public string HostId { get; }
        public string HostVersion { get; }
        public string ModelId { get; }
        public string AvatarPackageId { get; }
        public IReadOnlyList<AvatarHostCapability> Capabilities { get; }
    }

    public sealed class AvatarHostBecameReady : AvatarHostEvent
    {
        public AvatarHostBecameReady(string hostId, string modelId, string avatarPackageId, AvatarWorkerWindowState workerWindowState, AvatarCompositionSurfaceState compositionSurfaceState, bool firstFramePresented, bool interactionReady, string summary)
        {
            HostId = hostId ?? string.Empty;
            ModelId = modelId ?? string.Empty;
            AvatarPackageId = avatarPackageId ?? string.Empty;
            WorkerWindowState = workerWindowState;
            CompositionSurfaceState = compositionSurfaceState;
            FirstFramePresented = firstFramePresented;
            InteractionReady = interactionReady;
            Summary = summary ?? string.Empty;
        }

        public string HostId { get; }
        public string ModelId { get; }
        public string AvatarPackageId { get; }
        public AvatarWorkerWindowState WorkerWindowState { get; }
        public AvatarCompositionSurfaceState CompositionSurfaceState { get; }
        public bool FirstFramePresented { get; }
        public bool InteractionReady { get; }
        public string Summary { get; }
    }

    public sealed class AvatarActionStateChanged : AvatarHostEvent
    {
        public AvatarActionStateChanged(string actionId, AvatarActionExecutionState? state, IReadOnlyList<string> activeActionIds, string message)
        {
            ActionId = actionId ?? string.Empty;
            State = state;
            ActiveActionIds = activeActionIds ?? throw new ArgumentNullException(nameof(activeActionIds));
            Message = message ?? string.Empty;
        }

        public string ActionId { get; }
        public AvatarActionExecutionState? State { get; }
        public IReadOnlyList<string> ActiveActionIds { get; }
        public string Message { get; }
    }

    public sealed class AvatarAnimationCompleted : AvatarHostEvent
    {
        public AvatarAnimationCompleted(string animationId) => AnimationId = animationId ?? throw new ArgumentNullException(nameof(animationId));
        public string AnimationId { get; }
    }

    public sealed class AvatarHostFailed : AvatarHostEvent
    {
        public AvatarHostFailed(string code, string message)
        {
            Code = code ?? throw new ArgumentNullException(nameof(code));
            Message = message ?? throw new ArgumentNullException(nameof(message));
        }

        public string Code { get; }
        public string Message { get; }
    }
}
