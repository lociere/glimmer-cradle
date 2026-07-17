using System;
using UnityEngine;

namespace GlimmerCradle.Avatar
{
    [Serializable]
    public sealed class AvatarSpeechProfile
    {
        public string mouthParameterId = "";
        public float intensityScale = 0.4f;
    }

    [Serializable]
    public sealed class AvatarGazeBinding
    {
        public string parameterId = "";
        public string axis = "x";
        public float factor = 1f;
    }

    [Serializable]
    public sealed class AvatarGazeProfile
    {
        public float responseTimeSeconds = 0.16f;
        public float targetRange = 1f;
        public AvatarPointerAttentionProfile pointerAttention = new AvatarPointerAttentionProfile();
        public AvatarGazeBinding[] bindings = Array.Empty<AvatarGazeBinding>();

        public bool IsAvailable => bindings != null && bindings.Length > 0;
    }

    [Serializable]
    public sealed class AvatarPointerAttentionProfile
    {
        public bool enabled = true;
        public float movementThreshold = 0.012f;
        public float holdSeconds = 0.9f;
        public float releaseSeconds = 0.55f;
        public float deadZone = 0.05f;
    }

    [Serializable]
    public sealed class AvatarBlinkProfile
    {
        public bool enabled = true;
        public float meanSeconds = 3.2f;
        public float maximumDeviationSeconds = 1.6f;
        public float timescale = 11f;
    }

    [Serializable]
    public sealed class AvatarBreathProfile
    {
        public bool enabled = true;
        public string parameterId = "";
        public float durationSeconds = 3.8f;
        public float normalizedOrigin = 0.5f;
        public float normalizedRange = 0.45f;
    }

    [Serializable]
    public sealed class AvatarPoseParameter
    {
        public string parameterId = "";
        public float value;
    }

    [Serializable]
    public sealed class AvatarIdleParameter
    {
        public string parameterId = "";
        public float amplitude;
        public float periodSeconds = 8f;
        public float phase;
    }

    [Serializable]
    public sealed class AvatarPostureProfile
    {
        public AvatarPoseParameter[] pose = Array.Empty<AvatarPoseParameter>();
        public AvatarIdleParameter[] idle = Array.Empty<AvatarIdleParameter>();
    }

    [Serializable]
    public sealed class AvatarBaselineProfile
    {
        public AvatarBlinkProfile blink = new AvatarBlinkProfile();
        public AvatarBreathProfile breath = new AvatarBreathProfile();
        public AvatarPostureProfile posture = new AvatarPostureProfile();
    }

    [Serializable]
    public sealed class AvatarBehaviorDocument
    {
        public int version = 1;
        public AvatarSpeechProfile speech = new AvatarSpeechProfile();
        public AvatarGazeProfile gaze = new AvatarGazeProfile();
        public AvatarBaselineProfile baseline = new AvatarBaselineProfile();
    }

    public sealed class AvatarBehaviorProfile
    {
        public AvatarSpeechProfile speech = new AvatarSpeechProfile();
        public AvatarGazeProfile gaze = new AvatarGazeProfile();
        public AvatarBaselineProfile baseline = new AvatarBaselineProfile();

        public static AvatarBehaviorProfile FromDocument(AvatarBehaviorDocument document)
        {
            var profile = new AvatarBehaviorProfile();
            if (document == null)
            {
                return profile;
            }

            profile.speech = document.speech ?? new AvatarSpeechProfile();
            profile.gaze = document.gaze ?? new AvatarGazeProfile();
            profile.baseline = document.baseline ?? new AvatarBaselineProfile();
            profile.gaze.responseTimeSeconds = Mathf.Clamp(profile.gaze.responseTimeSeconds, 0.04f, 1.5f);
            profile.gaze.targetRange = Mathf.Clamp(profile.gaze.targetRange, 0.1f, 4f);
            profile.gaze.pointerAttention ??= new AvatarPointerAttentionProfile();
            profile.gaze.pointerAttention.movementThreshold = Mathf.Clamp(profile.gaze.pointerAttention.movementThreshold, 0.001f, 1f);
            profile.gaze.pointerAttention.holdSeconds = Mathf.Clamp(profile.gaze.pointerAttention.holdSeconds, 0f, 10f);
            profile.gaze.pointerAttention.releaseSeconds = Mathf.Clamp(profile.gaze.pointerAttention.releaseSeconds, 0.04f, 3f);
            profile.gaze.pointerAttention.deadZone = Mathf.Clamp(profile.gaze.pointerAttention.deadZone, 0f, 0.5f);
            profile.baseline.posture ??= new AvatarPostureProfile();
            profile.baseline.posture.pose ??= Array.Empty<AvatarPoseParameter>();
            profile.baseline.posture.idle ??= Array.Empty<AvatarIdleParameter>();
            foreach (var idle in profile.baseline.posture.idle)
            {
                if (idle != null)
                {
                    idle.periodSeconds = Mathf.Clamp(idle.periodSeconds, 1.5f, 60f);
                    idle.phase = Mathf.Repeat(idle.phase, 1f);
                }
            }
            return profile;
        }
    }
}
