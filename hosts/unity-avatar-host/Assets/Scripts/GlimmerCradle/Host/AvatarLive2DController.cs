using System;
using System.Collections;
using System.IO;
using UnityEngine;
using UnityEngine.Networking;

namespace GlimmerCradle.Avatar
{
    public sealed class AvatarLive2DController : MonoBehaviour
    {
        [SerializeField] private AudioSource audioSource;
        private IAvatarModelDriver driver;
        private AvatarModelManifest manifest;
        private AvatarProtocolClient shellClient;
        private AvatarBehaviorController behaviorController;

        public bool IsReady => driver != null && driver.IsReady;
        public string DriverName => driver?.DriverName ?? "unavailable";
        public string ModelId => manifest?.modelId ?? "";
        public string AvatarPackageId => manifest?.avatarPackageId ?? "";
        public AvatarPresentationProfile Presentation => manifest?.presentation ?? new AvatarPresentationProfile();

        public bool Initialize(UnityAvatarHostConfig config, AvatarProtocolClient client)
        {
            shellClient = client;
            AvatarModelDescriptor descriptor;
            try
            {
                descriptor = AvatarModelRegistry.Load(config.modelRegistryFile).Resolve(config.modelId);
                manifest = AvatarModelManifestLoader.Load(descriptor);
            }
            catch (Exception ex)
            {
                ReportError("avatar_registry_invalid", ex.Message);
                return false;
            }

            if (string.IsNullOrWhiteSpace(manifest.resourceKey))
            {
                ReportError("model_resource_missing", $"模型 {descriptor.id} 未声明 Unity resourceKey");
                return false;
            }

            driver = ResolveDriver(descriptor.modelFormat);
            if (driver == null)
            {
                ReportError(
                    "avatar_driver_missing",
                    $"未找到可用的 {descriptor.modelFormat} 模型驱动。请导入兼容当前模型格式的 Unity SDK；静态贴图预览不会作为正式身体自动启用。"
                );
                return false;
            }

            driver.Initialize(manifest);
            if (!driver.IsReady)
            {
                ReportError("avatar_driver_not_ready", $"Avatar driver 未就绪: {driver.DriverName}");
                return false;
            }

            if (!driver.TryPreparePresentation(UnityAvatarHostBootstrap.GetPresentationCamera(), out var presentationError))
            {
                ReportError("avatar_presentation_not_ready", presentationError);
                return false;
            }

            if (audioSource == null)
            {
                audioSource = gameObject.AddComponent<AudioSource>();
            }

            behaviorController = GetComponent<AvatarBehaviorController>() ?? gameObject.AddComponent<AvatarBehaviorController>();
            behaviorController.ActionStateChanged -= OnActionStateChanged;
            behaviorController.ActionStateChanged += OnActionStateChanged;
            behaviorController.Initialize(manifest, driver);
            StartCoroutine(CaptureFrameIfRequested());
            Debug.Log($"[UnityAvatarHost] 模型已就绪 model={manifest.modelId} driver={driver.DriverName}");
            return true;
        }

        private void Update()
        {
            behaviorController?.Tick(Time.deltaTime);
        }

        public void ApplyEmotion(SetAvatarEmotionCommand command)
        {
            if (command == null || string.IsNullOrWhiteSpace(command.EmotionType))
            {
                return;
            }

            behaviorController?.ApplyEmotion(command);
        }

        public void ApplyExpression(SetAvatarExpressionCommand command)
        {
            if (command == null || string.IsNullOrWhiteSpace(command.ExpressionId))
            {
                return;
            }

            behaviorController?.ApplyExpression(command);
        }

        public void PlayMotion(PlayAvatarMotionCommand command)
        {
            if (command == null || string.IsNullOrWhiteSpace(command.MotionId))
            {
                return;
            }

            behaviorController?.PlayMotion(command);
        }

        public void ApplyLipSync(SetAvatarLipSyncCommand command)
        {
            if (command == null)
            {
                return;
            }

            behaviorController?.SetSpeechPulse(command.Amplitude);
        }

        public void ApplyParameter(SetAvatarParameterCommand command)
        {
            if (command == null || string.IsNullOrWhiteSpace(command.ParameterId))
            {
                return;
            }

            driver?.SetParameter(command.ParameterId, command.Value);
        }

        public void ApplyPresentation(SetAvatarPresentationCommand command)
        {
            if (command == null)
            {
                return;
            }

            // 身体始终完整适配相机；桌面驻留与显示大小由 Composition Host 负责。
        }

        public bool TryGetInteractionHull(out Rect viewportHull)
        {
            viewportHull = default;
            return driver != null && driver.TryGetInteractionHull(UnityAvatarHostBootstrap.GetPresentationCamera(), out viewportHull);
        }

        public void PlayAudio(PlayAvatarAudioCommand command)
        {
            if (command == null || audioSource == null)
            {
                return;
            }

            StartCoroutine(PlayAudioCoroutine(command));
        }

        public void ApplyThought(SetAvatarThoughtCommand command)
        {
            if (command == null)
            {
                return;
            }

            if (command.Active && manifest != null && manifest.actions.TryResolve("state.thinking", out _))
            {
                behaviorController?.ApplyIntent(new ExecuteAvatarActionCommand(
                    "state.thinking", AvatarActionOperation.Activate, AvatarActionSource.System, 30));
            }
            else if (!command.Active && manifest != null && manifest.actions.TryResolve("state.thinking", out _))
            {
                behaviorController?.ApplyIntent(new ExecuteAvatarActionCommand(
                    "state.thinking", AvatarActionOperation.Deactivate, AvatarActionSource.System, 30));
            }
        }

        public void PlayIdle()
        {
            behaviorController?.EnsureIdleMotion();
        }

        public void ApplyIntent(ExecuteAvatarActionCommand command)
        {
            behaviorController?.ApplyIntent(command);
        }

        public void LoadScene(LoadAvatarSceneCommand command)
        {
            if (command == null || string.IsNullOrWhiteSpace(command.SceneId))
            {
                return;
            }

            ReportError("scene_not_implemented", $"Unity 场景加载尚未接入: {command.SceneId}");
        }

        public void UnloadScene(UnloadAvatarSceneCommand command)
        {
        }

        private IAvatarModelDriver ResolveDriver(string modelFormat)
        {
            if (string.Equals(modelFormat, "cubism4", StringComparison.OrdinalIgnoreCase)
                || string.Equals(modelFormat, "cubism5", StringComparison.OrdinalIgnoreCase))
            {
                var cubismDriver = GetComponent<CubismAvatarModelDriver>();
                return cubismDriver != null ? cubismDriver : gameObject.AddComponent<CubismAvatarModelDriver>();
            }

            return null;
        }

        private IEnumerator PlayAudioCoroutine(PlayAvatarAudioCommand command)
        {
            if (!string.IsNullOrWhiteSpace(command.AudioData))
            {
                var clip = WavUtility.FromBase64(command.AudioData, command.AudioId);
                if (clip != null)
                {
                    PlayClip(clip);
                    yield break;
                }
            }

            if (string.IsNullOrWhiteSpace(command.AudioUri))
            {
                yield break;
            }

            using (var request = UnityWebRequestMultimedia.GetAudioClip(command.AudioUri, AudioType.WAV))
            {
                yield return request.SendWebRequest();
#if UNITY_2020_2_OR_NEWER
                if (request.result != UnityWebRequest.Result.Success)
#else
                if (request.isNetworkError || request.isHttpError)
#endif
                {
                    ReportError("audio_load_failed", request.error);
                    yield break;
                }

                PlayClip(DownloadHandlerAudioClip.GetContent(request));
            }
        }

        private IEnumerator CaptureFrameIfRequested()
        {
            var outputPath = Environment.GetEnvironmentVariable("GLIMMER_CRADLE_AVATAR_FRAME_CAPTURE_PATH");
            if (string.IsNullOrWhiteSpace(outputPath))
            {
                yield break;
            }

            // 仅用于显式排障：捕获 Unity 最终帧缓冲，区分 Cubism 未绘制与 Windows 合成失败。
            yield return new WaitForEndOfFrame();
            yield return new WaitForEndOfFrame();

            try
            {
                var directory = Path.GetDirectoryName(outputPath);
                if (!string.IsNullOrWhiteSpace(directory))
                {
                    Directory.CreateDirectory(directory);
                }
                UnityEngine.ScreenCapture.CaptureScreenshot(outputPath);
                Debug.Log($"[UnityAvatarHost] 已请求写入诊断帧: {outputPath}");
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[UnityAvatarHost] 写入诊断帧失败: {ex.Message}");
            }
        }

        private void PlayClip(AudioClip clip)
        {
            audioSource.clip = clip;
            audioSource.Play();
            behaviorController?.SetSpeechPulse(1f);
        }

        public AvatarActionStateChanged GetActionStateSnapshot()
        {
            return behaviorController?.GetActionStateSnapshot()
                ?? new AvatarActionStateChanged(null, null, Array.Empty<string>(), null);
        }

        private void OnActionStateChanged(AvatarActionStateChanged state)
        {
            shellClient?.ReportActionState(state);
        }

        private void ReportError(string code, string message)
        {
            Debug.LogWarning($"[UnityAvatarHost] {code}: {message}");
            shellClient?.ReportError(code, message);
        }
    }
}
