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

        public event Action<AvatarActionStateChanged> ActionStateChanged;

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

        public AvatarActionStateChanged GetActionStateSnapshot()
        {
            return actionScheduler.Snapshot();
        }

        public void ApplyIntent(ExecuteAvatarActionCommand command)
        {
            var state = actionScheduler.Apply(command);
            if (state.State == AvatarActionExecutionState.Rejected)
            {
                Debug.LogWarning($"[UnityAvatarHost] 动作请求被拒绝 action={state.ActionId} reason={state.Message}");
            }
            ActionStateChanged?.Invoke(state);
        }

        public void ApplyEmotion(SetAvatarEmotionCommand command)
        {
            if (command == null || string.IsNullOrWhiteSpace(command.EmotionType) || driver == null)
            {
                return;
            }
            var expressionId = manifest.emotionToExpression.TryGetValue(command.EmotionType, out var mapped)
                ? mapped
                : command.EmotionType;
            driver.SetEmotion(expressionId, Mathf.Clamp01(command.Intensity));
        }

        public void ApplyExpression(SetAvatarExpressionCommand command)
        {
            if (command != null && !string.IsNullOrWhiteSpace(command.ExpressionId))
            {
                driver?.SetExpression(command.ExpressionId);
            }
        }

        public void PlayMotion(PlayAvatarMotionCommand command)
        {
            if (command != null && !string.IsNullOrWhiteSpace(command.MotionId))
            {
                driver?.PlayMotion(manifest.ResolveMotionId(command.MotionId), command.Loop, command.Priority);
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
