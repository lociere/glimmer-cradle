using UnityEngine;

namespace GlimmerCradle.Avatar
{
    public interface IAvatarModelDriver
    {
        bool IsReady { get; }
        string DriverName { get; }
        void Initialize(AvatarModelManifest manifest);
        bool TryPreparePresentation(Camera camera, out string error);
        void SetEmotion(string emotionId, float intensity);
        void SetExpression(string expressionId);
        bool TryTriggerExpression(string expressionId, out string error);
        bool TrySetActionExpression(string actionId, string expressionId, bool active, out string error);
        void PlayMotion(string motionId, bool loop, int priority);
        bool TryPlayMotion(string motionId, bool loop, int priority, out string error);
        void SetParameter(string parameterId, float value);
        void ApplyBehaviorFrame(AvatarBehaviorFrame frame);
        bool TryGetInteractionHull(Camera camera, out Rect viewportHull);
        void Tick(float deltaTime);
    }
}
