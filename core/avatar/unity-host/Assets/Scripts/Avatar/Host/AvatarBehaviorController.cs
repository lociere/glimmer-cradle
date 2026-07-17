using System;
using UnityEngine;

namespace GlimmerCradle.Avatar
{
    /// <summary>
    /// 身体行为组合根：离散动作由调度器处理，连续输入由求值器合成为单帧身体状态。
    /// </summary>
    public sealed class AvatarBehaviorController : MonoBehaviour
    {
        [SerializeField] private float mouthReleaseSpeed = 8f;

        private readonly AvatarActionScheduler actionScheduler = new AvatarActionScheduler();
        private readonly AvatarBehaviorEvaluator evaluator = new AvatarBehaviorEvaluator();
        private readonly AvatarIdleMotionScheduler idleMotionScheduler = new AvatarIdleMotionScheduler();
        private IAvatarModelDriver driver;
        private AvatarModelManifest manifest;
        private AvatarPresentationController presentationController;

        public event Action<AvatarActionStatePayload> ActionStateChanged;

        public void Initialize(AvatarModelManifest nextManifest, IAvatarModelDriver nextDriver)
        {
            manifest = nextManifest;
            driver = nextDriver;
            presentationController = GetComponent<AvatarPresentationController>();
            actionScheduler.Initialize(manifest?.actions, driver);
            evaluator.Initialize(manifest?.behavior, mouthReleaseSpeed);
            idleMotionScheduler.Initialize(driver);
        }

        public void Tick(float deltaTime)
        {
            if (driver == null || manifest == null)
            {
                return;
            }

            driver.Tick(deltaTime);
            var pointer = Vector2.zero;
            var hasPointer = presentationController != null
                && presentationController.TryGetPointerNormalized(out pointer);
            var frame = evaluator.Evaluate(deltaTime, Time.unscaledTime, hasPointer, pointer);
            driver.ApplyBehaviorFrame(frame);
        }

        public AvatarActionStatePayload GetActionStateSnapshot()
        {
            return actionScheduler.Snapshot();
        }

        public void ApplyIntent(AvatarIntentPayload payload)
        {
            var state = actionScheduler.Apply(payload);
            if (state.state == "rejected")
            {
                Debug.LogWarning($"[UnityAvatarHost] 动作请求被拒绝 action={state.action_id} reason={state.message}");
            }
            ActionStateChanged?.Invoke(state);
        }

        public void ApplyEmotion(EmotionPayload payload)
        {
            if (payload == null || string.IsNullOrWhiteSpace(payload.emotion_type) || driver == null)
            {
                return;
            }
            var expressionId = manifest.emotionToExpression.TryGetValue(payload.emotion_type, out var mapped)
                ? mapped
                : payload.emotion_type;
            driver.SetEmotion(expressionId, Mathf.Clamp01(payload.intensity));
        }

        public void ApplyExpression(AvatarExpressionPayload payload)
        {
            if (payload != null && !string.IsNullOrWhiteSpace(payload.expression_id))
            {
                driver?.SetExpression(payload.expression_id);
            }
        }

        public void PlayMotion(AvatarMotionPayload payload)
        {
            if (payload != null && !string.IsNullOrWhiteSpace(payload.motion_id))
            {
                driver?.PlayMotion(manifest.ResolveMotionId(payload.motion_id), payload.loop, payload.priority);
            }
        }

        public void EnsureIdleMotion()
        {
            idleMotionScheduler.EnsureRunning();
        }

        public void SetSpeechPulse(float amplitude)
        {
            var intensity = manifest?.behavior?.speech?.intensityScale ?? 0f;
            evaluator.SubmitSpeechPulse(Mathf.Clamp01(amplitude) * intensity);
        }
    }
}
