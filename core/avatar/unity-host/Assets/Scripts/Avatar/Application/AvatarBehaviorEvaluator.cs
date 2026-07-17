using UnityEngine;

namespace GlimmerCradle.Avatar
{
    /// <summary>
    /// 连续身体信号的求值器。它只持有采样状态并产出帧，不接触 Cubism、窗口或网络对象。
    /// </summary>
    public sealed class AvatarBehaviorEvaluator
    {
        private AvatarGazeProfile gazeProfile = new AvatarGazeProfile();
        private float mouthReleaseSpeed;
        private float targetMouthOpen;
        private float currentMouthOpen;
        private Vector2 lastPointer;
        private Vector2 pointerAttentionTarget;
        private Vector2 currentGaze;
        private Vector2 gazeVelocity;
        private float pointerLastMovedAt = float.NegativeInfinity;
        private bool hasPointerSample;

        public void Initialize(AvatarBehaviorProfile profile, float nextMouthReleaseSpeed)
        {
            gazeProfile = profile?.gaze ?? new AvatarGazeProfile();
            mouthReleaseSpeed = Mathf.Max(0.1f, nextMouthReleaseSpeed);
            targetMouthOpen = 0f;
            currentMouthOpen = 0f;
            lastPointer = Vector2.zero;
            pointerAttentionTarget = Vector2.zero;
            currentGaze = Vector2.zero;
            gazeVelocity = Vector2.zero;
            pointerLastMovedAt = float.NegativeInfinity;
            hasPointerSample = false;
        }

        public void SubmitSpeechPulse(float amplitude)
        {
            targetMouthOpen = Mathf.Max(targetMouthOpen, Mathf.Clamp01(amplitude));
        }

        public AvatarBehaviorFrame Evaluate(float deltaTime, float now, bool hasPointer, Vector2 pointer)
        {
            var safeDeltaTime = Mathf.Max(0.0001f, deltaTime);
            UpdatePointerAttention(now, hasPointer, pointer);

            currentMouthOpen = Mathf.MoveTowards(
                currentMouthOpen,
                targetMouthOpen,
                mouthReleaseSpeed * safeDeltaTime
            );
            targetMouthOpen = Mathf.MoveTowards(targetMouthOpen, 0f, mouthReleaseSpeed * safeDeltaTime);

            var attention = gazeProfile.pointerAttention;
            var desiredGaze = hasPointerSample && attention != null
                && now - pointerLastMovedAt <= attention.holdSeconds
                ? pointerAttentionTarget
                : Vector2.zero;
            var smoothTime = desiredGaze == Vector2.zero
                ? Mathf.Max(0.04f, attention?.releaseSeconds ?? 0.55f)
                : Mathf.Max(0.04f, gazeProfile.responseTimeSeconds);
            currentGaze = Vector2.SmoothDamp(
                currentGaze,
                desiredGaze,
                ref gazeVelocity,
                smoothTime,
                Mathf.Infinity,
                safeDeltaTime
            );
            return new AvatarBehaviorFrame(currentMouthOpen, currentGaze);
        }

        private void UpdatePointerAttention(float now, bool hasPointer, Vector2 pointer)
        {
            var attention = gazeProfile.pointerAttention;
            if (!gazeProfile.IsAvailable || attention == null || !attention.enabled || !hasPointer)
            {
                return;
            }
            if (!hasPointerSample || Vector2.Distance(pointer, lastPointer) >= attention.movementThreshold)
            {
                pointerAttentionTarget = ApplyDeadZone(pointer, attention.deadZone);
                pointerLastMovedAt = now;
            }
            lastPointer = pointer;
            hasPointerSample = true;
        }

        private static Vector2 ApplyDeadZone(Vector2 value, float deadZone)
        {
            var magnitude = value.magnitude;
            if (magnitude <= deadZone)
            {
                return Vector2.zero;
            }
            var normalizedMagnitude = Mathf.InverseLerp(deadZone, 1f, Mathf.Min(1f, magnitude));
            return value.normalized * normalizedMagnitude;
        }
    }
}
