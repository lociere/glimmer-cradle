using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using GlimmerCradle.UnityAvatarHost.Adapters;

namespace GlimmerCradle.Avatar
{
    public sealed class AvatarProtocolClient : MonoBehaviour, IAvatarCommandSink
    {
        [SerializeField] private string kernelUrl = "";
        [SerializeField] private string hostId = "unity-avatar";
        [SerializeField] private string hostVersion = "0.1.8";
        [SerializeField] private string modelId = "";
        [SerializeField] private string avatarPackageId = "";
        [SerializeField] private AvatarLive2DController avatarController;
        [SerializeField] private bool connectOnStart = true;

        private readonly ConcurrentQueue<Action> mainThreadQueue = new ConcurrentQueue<Action>();
        private ClientWebSocket socket;
        private CancellationTokenSource lifetime;
        private UnityAvatarHostConfig config;
        private bool avatarReady;
        private bool readyAnnounced;
        private bool helloSent;
        private bool presentationReady;
        private AvatarPresentationController presentationController;
        private readonly List<AvatarHostErrorPayload> startupErrors = new List<AvatarHostErrorPayload>();
        private readonly SemaphoreSlim sendLock = new SemaphoreSlim(1, 1);

        private async void Start()
        {
            config = UnityAvatarHostConfig.Load();
            kernelUrl = string.IsNullOrWhiteSpace(config.kernelUrl) ? kernelUrl : config.kernelUrl;
            if (string.IsNullOrWhiteSpace(kernelUrl))
            {
                ReportError("avatar_endpoint_missing", "Avatar Host 未收到 Kernel 动态端点");
                enabled = false;
                return;
            }
            hostId = string.IsNullOrWhiteSpace(config.hostId) ? hostId : config.hostId;
            hostVersion = string.IsNullOrWhiteSpace(config.hostVersion) ? hostVersion : config.hostVersion;
            modelId = string.IsNullOrWhiteSpace(config.modelId) ? modelId : config.modelId;
            lifetime = new CancellationTokenSource();

            presentationController = GetComponent<AvatarPresentationController>();
            if (presentationController == null)
            {
                ReportError("avatar_presentation_missing", "Avatar 缺少 AvatarPresentationController");
            }
            else
            {
                presentationController.PresentationReady += HandlePresentationReady;
                presentationReady = presentationController.IsReady;
            }
            if (avatarController == null)
            {
                avatarController = GetComponent<AvatarLive2DController>();
            }
            if (avatarController != null)
            {
                try
                {
                    avatarReady = avatarController.Initialize(config, this);
                    modelId = avatarController.ModelId;
                    avatarPackageId = avatarController.AvatarPackageId;
                    presentationController?.ApplyPresentation(avatarController.Presentation);
                }
                catch (Exception ex)
                {
                    avatarReady = false;
                    ReportError("avatar_initialization_failed", ex.ToString());
                    Debug.LogException(ex);
                }
            }

            if (connectOnStart)
            {
                await ConnectLoopAsync(lifetime.Token);
            }
        }

        private void Update()
        {
            while (mainThreadQueue.TryDequeue(out var action))
            {
                action.Invoke();
            }

            if (!readyAnnounced
                && avatarReady
                && presentationController != null
                && presentationController.HasPresentedFirstFrame)
            {
                presentationReady = presentationController.IsReady;
                AnnounceReadyWhenPossible();
            }
        }

        private async void OnDestroy()
        {
            lifetime?.Cancel();
            if (presentationController != null)
            {
                presentationController.PresentationReady -= HandlePresentationReady;
            }
            try
            {
                if (socket != null && socket.State == WebSocketState.Open)
                {
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Unity shell shutdown", CancellationToken.None);
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[UnityAvatarHost] 关闭 WebSocket 时忽略异常: {ex.Message}");
            }
            socket?.Dispose();
            lifetime?.Dispose();
            sendLock.Dispose();
        }

        public void ReportError(string code, string message)
        {
            if (lifetime == null || lifetime.IsCancellationRequested)
            {
                return;
            }

            var payload = new AvatarHostErrorPayload
            {
                code = code,
                message = message,
            };
            if (socket == null || socket.State != WebSocketState.Open)
            {
                startupErrors.Add(payload);
                return;
            }

            _ = SendFrameAsync(new AvatarUpstreamFrame
            {
                kind = "error",
                timestamp = NowMs(),
                error = payload,
            }, lifetime.Token);
        }

        public void ReportAnimationComplete(string animationId)
        {
            if (lifetime == null || lifetime.IsCancellationRequested)
            {
                return;
            }

            _ = SendFrameAsync(new AvatarUpstreamFrame
            {
                kind = "animation_complete",
                timestamp = NowMs(),
                animation_complete = new AnimationCompletePayload
                {
                    animation_id = animationId,
                },
            }, lifetime.Token);
        }

        public void ReportActionState(AvatarActionStatePayload state)
        {
            if (state == null || lifetime == null || lifetime.IsCancellationRequested)
            {
                return;
            }
            _ = SendFrameAsync(new AvatarUpstreamFrame
            {
                kind = "avatar_action_state",
                timestamp = NowMs(),
                avatar_action_state = new AvatarActionStatePayload
                {
                    action_id = state.action_id,
                    state = state.state,
                    active_action_ids = state.active_action_ids ?? Array.Empty<string>(),
                    message = state.message,
                },
            }, lifetime.Token);
        }

        private async Task ConnectLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    await ConnectAsync(token);
                    await ReceiveLoopAsync(token);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch (Exception ex)
                {
                    Debug.LogWarning($"[UnityAvatarHost] Kernel 连接失败，稍后重试: {ex.Message}");
                }
                finally
                {
                    socket?.Dispose();
                    socket = null;
                }

                var delayMs = Mathf.Max(0.5f, config?.reconnectDelaySeconds ?? 2.0f) * 1000;
                await Task.Delay((int)delayMs, token);
            }
        }

        private async Task ConnectAsync(CancellationToken token)
        {
            socket = new ClientWebSocket();
            await socket.ConnectAsync(new Uri(kernelUrl), token);
            readyAnnounced = false;
            helloSent = false;
            await SendHelloAsync(token);
            helloSent = true;
            AnnounceReadyWhenPossible();
        }

        private void HandlePresentationReady()
        {
            presentationReady = presentationController != null && presentationController.IsReady;
            Debug.Log("[UnityAvatarHost] Composition Host 已呈现首帧，等待发布 Host 就绪状态");
            AnnounceReadyWhenPossible();
        }

        private void AnnounceReadyWhenPossible()
        {
            var firstFramePresented = presentationController?.HasPresentedFirstFrame ?? false;
            if (readyAnnounced
                || !helloSent
                || !avatarReady
                || !presentationReady
                || !firstFramePresented
                || socket == null
                || socket.State != WebSocketState.Open
                || lifetime == null
                || lifetime.IsCancellationRequested)
            {
                return;
            }

            readyAnnounced = true;
            _ = PublishReadyAsync(lifetime.Token);
        }

        private async Task PublishReadyAsync(CancellationToken token)
        {
            var compositionHost = presentationController?.CompositionHost;
            var firstFramePresented = compositionHost?.HasPresentedFirstFrame ?? false;
            var interactionReady = avatarReady && presentationReady && firstFramePresented;
            if (!firstFramePresented || !interactionReady)
            {
                readyAnnounced = false;
                Debug.LogWarning(
                    "[UnityAvatarHost] host_ready 被拦截，等待正式首帧与交互门完成: "
                    + (compositionHost?.GetReadinessDiagnostic() ?? "composition_host_unavailable")
                );
                return;
            }

            await SendFrameAsync(new AvatarUpstreamFrame
            {
                kind = "host_ready",
                timestamp = NowMs(),
                host_ready = new AvatarHostReadyPayload
                {
                    host_id = hostId,
                    model_id = modelId,
                    avatar_package_id = avatarPackageId,
                    worker_window_state = compositionHost?.GetWorkerWindowState() ?? "unknown",
                    composition_surface_state = compositionHost?.GetCompositionSurfaceState() ?? "unknown",
                    first_frame_presented = firstFramePresented,
                    interaction_ready = interactionReady,
                    summary = "Avatar Package / composition surface / first frame / interaction ready",
                },
            }, token);
            Debug.Log("[UnityAvatarHost] Avatar 已就绪：模型、合成与首帧均已完成");
            ReportActionState(avatarController?.GetActionStateSnapshot());
        }

        private async Task SendHelloAsync(CancellationToken token)
        {
            await SendFrameAsync(new AvatarUpstreamFrame
            {
                kind = "host_hello",
                timestamp = NowMs(),
                host_hello = new AvatarHostHelloPayload
                {
                    host_kind = "unity",
                    host_id = hostId,
                    host_version = hostVersion,
                    model_id = modelId,
                    avatar_package_id = avatarPackageId,
                    capabilities = new[]
                    {
                        "expression",
                        "motion",
                        "avatar_intent",
                        "lip_sync",
                        "parameter",
                        "audio_play",
                        "load_scene"
                    },
                },
            }, token);

            foreach (var error in startupErrors)
            {
                await SendFrameAsync(new AvatarUpstreamFrame
                {
                    kind = "error",
                    timestamp = NowMs(),
                    error = error,
                }, token);
            }
            startupErrors.Clear();
        }

        private async Task ReceiveLoopAsync(CancellationToken token)
        {
            var buffer = new byte[64 * 1024];
            while (!token.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                var builder = new StringBuilder();
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        return;
                    }
                    builder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                } while (!result.EndOfMessage);

                HandleFrame(builder.ToString());
            }
        }

        private void HandleFrame(string json)
        {
            var frame = AvatarContractAdapter.DeserializeDownstream(json);
            if (frame == null || string.IsNullOrWhiteSpace(frame.kind))
            {
                return;
            }

            if (frame.kind == "ping")
            {
                _ = SendFrameAsync(new AvatarUpstreamFrame
                {
                    kind = "pong",
                    timestamp = NowMs(),
                }, lifetime.Token);
                return;
            }

            mainThreadQueue.Enqueue(() => ApplyFrame(frame));
        }

        private void ApplyFrame(AvatarDownstreamFrame frame)
        {
            if (avatarController == null)
            {
                return;
            }

            AvatarFrameDispatcher.TryDispatch(frame, this);
        }

        public void Shutdown() => Application.Quit();
        public void ApplyEmotion(EmotionPayload payload) => avatarController.ApplyEmotion(payload);
        public void ApplyExpression(AvatarExpressionPayload payload) => avatarController.ApplyExpression(payload);
        public void PlayMotion(AvatarMotionPayload payload) => avatarController.PlayMotion(payload);
        public void ApplyLipSync(AvatarLipSyncPayload payload) => avatarController.ApplyLipSync(payload);
        public void ApplyParameter(AvatarParameterPayload payload) => avatarController.ApplyParameter(payload);
        public void ApplyIntent(AvatarIntentPayload payload) => avatarController.ApplyIntent(payload);

        public void ApplyPresentation(AvatarPresentationPayload payload)
        {
            avatarController.ApplyPresentation(payload);
            presentationController?.ApplyPresentationCommand(
                payload?.placement_id,
                payload?.display_scale ?? 0f,
                payload != null && payload.reset_placement
            );
        }

        public void ApplyCharacterPresentation(CharacterPresentationProjectionPayload payload)
        {
            presentationController?.ApplyPresentationCommand(
                payload?.appearance?.placement_id,
                payload?.appearance?.display_scale ?? 0f,
                false
            );
        }

        public void PlayAudio(AudioPlayPayload payload) => avatarController.PlayAudio(payload);
        public void ApplyThought(ThoughtPayload payload) => avatarController.ApplyThought(payload);
        public void PlayIdle() => avatarController.PlayIdle();
        public void LoadScene(LoadScenePayload payload) => avatarController.LoadScene(payload);
        public void UnloadScene(UnloadScenePayload payload) => avatarController.UnloadScene(payload);

        private async Task SendFrameAsync(AvatarUpstreamFrame frame, CancellationToken token)
        {
            if (socket == null || socket.State != WebSocketState.Open)
            {
                return;
            }

            await sendLock.WaitAsync(token);
            try
            {
                var payload = Encoding.UTF8.GetBytes(AvatarContractAdapter.SerializeUpstream(frame));
                await socket.SendAsync(new ArraySegment<byte>(payload), WebSocketMessageType.Text, true, token);
            }
            catch (Exception ex) when (!(ex is OperationCanceledException))
            {
                Debug.LogWarning($"[UnityAvatarHost] 发送上行帧失败: {ex.Message}");
            }
            finally
            {
                sendLock.Release();
            }
        }

        private static double NowMs()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }
    }
}
