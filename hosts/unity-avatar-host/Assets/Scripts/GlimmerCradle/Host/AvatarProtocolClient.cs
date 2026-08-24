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
        private readonly List<AvatarHostFailed> startupErrors = new List<AvatarHostFailed>();
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

        public void ReportError(string code, string message, string traceId = null)
        {
            if (lifetime == null || lifetime.IsCancellationRequested)
            {
                return;
            }

            var failure = new AvatarHostFailed(code, message);
            if (socket == null || socket.State != WebSocketState.Open)
            {
                startupErrors.Add(failure);
                return;
            }

            _ = SendHostEventAsync(failure, lifetime.Token, traceId);
        }

        public void ReportAnimationComplete(string animationId)
        {
            if (lifetime == null || lifetime.IsCancellationRequested)
            {
                return;
            }

            _ = SendHostEventAsync(new AvatarAnimationCompleted(animationId), lifetime.Token);
        }

        public void ReportActionState(AvatarActionStateChanged state)
        {
            if (state == null || lifetime == null || lifetime.IsCancellationRequested)
            {
                return;
            }
            _ = SendHostEventAsync(state, lifetime.Token);
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

            await SendHostEventAsync(new AvatarHostBecameReady(
                hostId,
                modelId,
                avatarPackageId,
                ParseWorkerWindowState(compositionHost?.GetWorkerWindowState()),
                ParseCompositionSurfaceState(compositionHost?.GetCompositionSurfaceState()),
                firstFramePresented,
                interactionReady,
                "Avatar Package / composition surface / first frame / interaction ready"), token);
            Debug.Log("[UnityAvatarHost] Avatar 已就绪：模型、合成与首帧均已完成");
            ReportActionState(avatarController?.GetActionStateSnapshot());
        }

        private async Task SendHelloAsync(CancellationToken token)
        {
            await SendHostEventAsync(new AvatarHostStarted(
                hostId,
                hostVersion,
                modelId,
                avatarPackageId,
                new[]
                {
                    AvatarHostCapability.Expression,
                    AvatarHostCapability.Motion,
                    AvatarHostCapability.AvatarIntent,
                    AvatarHostCapability.LipSync,
                    AvatarHostCapability.Parameter,
                    AvatarHostCapability.AudioPlay,
                    AvatarHostCapability.LoadScene,
                }), token);

            foreach (var error in startupErrors)
            {
                await SendHostEventAsync(error, token);
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
            var result = AvatarContractAdapter.ParseDownstream(json);
            if (!result.IsSuccess)
            {
                Debug.LogWarning($"[UnityAvatarHost] 拒绝无效 Avatar 帧 code={result.Failure.WireCode} detail={result.Failure.Message}");
                ReportError(result.Failure.WireCode, result.Failure.Message, result.Failure.TraceId);
                return;
            }

            if (result.Message.IsPing)
            {
                _ = SendPongAsync(result.Message.TraceId, lifetime.Token);
                return;
            }

            mainThreadQueue.Enqueue(() => ApplyCommand(result.Message.Command));
        }

        private void ApplyCommand(AvatarCommand command)
        {
            if (avatarController == null)
            {
                return;
            }

            AvatarCommandDispatcher.Dispatch(command, this);
        }

        public void Shutdown(ShutdownAvatarCommand command) => Application.Quit();
        public void ApplyEmotion(SetAvatarEmotionCommand command) => avatarController.ApplyEmotion(command);
        public void ApplyExpression(SetAvatarExpressionCommand command) => avatarController.ApplyExpression(command);
        public void PlayMotion(PlayAvatarMotionCommand command) => avatarController.PlayMotion(command);
        public void ApplyLipSync(SetAvatarLipSyncCommand command) => avatarController.ApplyLipSync(command);
        public void ApplyParameter(SetAvatarParameterCommand command) => avatarController.ApplyParameter(command);
        public void ApplyIntent(ExecuteAvatarActionCommand command) => avatarController.ApplyIntent(command);

        public void ApplyPresentation(SetAvatarPresentationCommand command)
        {
            avatarController.ApplyPresentation(command);
            presentationController?.ApplyPresentationCommand(
                command?.PlacementId,
                command?.DisplayScale ?? 0f,
                command != null && command.ResetPlacement
            );
        }

        public void ApplyCharacterPresentation(ApplyCharacterPresentationCommand command)
        {
            presentationController?.ApplyPresentationCommand(
                command?.PlacementId,
                command?.DisplayScale ?? 0f,
                false
            );
        }

        public void PlayAudio(PlayAvatarAudioCommand command) => avatarController.PlayAudio(command);
        public void ApplyThought(SetAvatarThoughtCommand command) => avatarController.ApplyThought(command);
        public void PlayIdle(PlayIdleAvatarCommand command) => avatarController.PlayIdle();
        public void LoadScene(LoadAvatarSceneCommand command) => avatarController.LoadScene(command);
        public void UnloadScene(UnloadAvatarSceneCommand command) => avatarController.UnloadScene(command);

        private async Task SendHostEventAsync(AvatarHostEvent hostEvent, CancellationToken token, string traceId = null)
        {
            await SendWireJsonAsync(AvatarContractAdapter.SerializeHostEvent(hostEvent, traceId, NowMs()), token);
        }

        private async Task SendPongAsync(string traceId, CancellationToken token)
        {
            await SendWireJsonAsync(AvatarContractAdapter.SerializePong(traceId, NowMs()), token);
        }

        private async Task SendWireJsonAsync(string json, CancellationToken token)
        {
            if (socket == null || socket.State != WebSocketState.Open)
            {
                return;
            }

            await sendLock.WaitAsync(token);
            try
            {
                var payload = Encoding.UTF8.GetBytes(json);
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

        private static AvatarWorkerWindowState ParseWorkerWindowState(string value)
        {
            switch (value)
            {
                case "isolated": return AvatarWorkerWindowState.Isolated;
                case "visible": return AvatarWorkerWindowState.Visible;
                default: return AvatarWorkerWindowState.Unknown;
            }
        }

        private static AvatarCompositionSurfaceState ParseCompositionSurfaceState(string value)
        {
            switch (value)
            {
                case "attached": return AvatarCompositionSurfaceState.Attached;
                case "failed": return AvatarCompositionSurfaceState.Failed;
                default: return AvatarCompositionSurfaceState.Unknown;
            }
        }
    }
}
