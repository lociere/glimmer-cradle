using System;
using System.Collections.Generic;
using Google.Protobuf;
using Contract = GlimmerCradle.Contracts.Glimmer.Avatar.V1;
using GlimmerCradle.Avatar;

namespace GlimmerCradle.UnityAvatarHost.Adapters
{
    public enum AvatarContractFailureCode
    {
        MalformedJson,
        MissingRequiredField,
        UnknownKind,
        MissingPayload,
        MismatchedPayload,
        UnknownEnum,
    }

    public sealed class AvatarContractFailure
    {
        public AvatarContractFailure(AvatarContractFailureCode code, string message, string traceId)
        {
            Code = code;
            Message = message ?? string.Empty;
            TraceId = traceId ?? string.Empty;
        }

        public AvatarContractFailureCode Code { get; }
        public string Message { get; }
        public string TraceId { get; }
        public string WireCode => "avatar_contract_" + ToWireCode(Code);

        private static string ToWireCode(AvatarContractFailureCode code)
        {
            switch (code)
            {
                case AvatarContractFailureCode.MalformedJson: return "malformed_json";
                case AvatarContractFailureCode.MissingRequiredField: return "missing_required_field";
                case AvatarContractFailureCode.UnknownKind: return "unknown_kind";
                case AvatarContractFailureCode.MissingPayload: return "missing_payload";
                case AvatarContractFailureCode.MismatchedPayload: return "mismatched_payload";
                case AvatarContractFailureCode.UnknownEnum: return "unknown_enum";
                default: throw new ArgumentOutOfRangeException(nameof(code), code, null);
            }
        }
    }

    public sealed class AvatarInboundMessage
    {
        internal AvatarInboundMessage(AvatarCommand command, bool isPing, string traceId, double timestamp)
        {
            Command = command;
            IsPing = isPing;
            TraceId = traceId ?? string.Empty;
            Timestamp = timestamp;
        }

        public AvatarCommand Command { get; }
        public bool IsPing { get; }
        public string TraceId { get; }
        public double Timestamp { get; }
    }

    public sealed class AvatarContractReadResult
    {
        private AvatarContractReadResult(AvatarInboundMessage message, AvatarContractFailure failure)
        {
            Message = message;
            Failure = failure;
        }

        public bool IsSuccess => Message != null;
        public AvatarInboundMessage Message { get; }
        public AvatarContractFailure Failure { get; }

        internal static AvatarContractReadResult Success(AvatarCommand command, bool isPing, Contract.AvatarDownstreamFrame source) =>
            new AvatarContractReadResult(new AvatarInboundMessage(command, isPing, source.TraceId, source.Timestamp), null);

        internal static AvatarContractReadResult Fail(AvatarContractFailureCode code, string message, string traceId = null) =>
            new AvatarContractReadResult(null, new AvatarContractFailure(code, message, traceId));
    }

    public sealed class AvatarContractSerializationException : Exception
    {
        public AvatarContractSerializationException(AvatarContractFailureCode code, string message) : base(message) => Code = code;
        public AvatarContractFailureCode Code { get; }
    }

    public static class AvatarContractAdapter
    {
        private static readonly JsonFormatter Formatter = new JsonFormatter(
            JsonFormatter.Settings.Default.WithPreserveProtoFieldNames(true));

        public static AvatarContractReadResult ParseDownstream(string json)
        {
            if (string.IsNullOrWhiteSpace(json))
            {
                return AvatarContractReadResult.Fail(AvatarContractFailureCode.MalformedJson, "Avatar 下行帧不是有效 JSON 文本");
            }

            Contract.AvatarDownstreamFrame source;
            try
            {
                source = JsonParser.Default.Parse<Contract.AvatarDownstreamFrame>(json);
            }
            catch (Exception ex)
            {
                return AvatarContractReadResult.Fail(
                    AvatarContractFailureCode.MalformedJson,
                    "Avatar 下行帧 JSON 解析失败: " + ex.Message);
            }

            if (!source.HasKind || string.IsNullOrWhiteSpace(source.Kind))
                return Fail(source, AvatarContractFailureCode.MissingRequiredField, "Avatar 下行帧缺少 kind");
            if (!source.HasTimestamp || double.IsNaN(source.Timestamp) || double.IsInfinity(source.Timestamp))
                return Fail(source, AvatarContractFailureCode.MissingRequiredField, "Avatar 下行帧缺少有效 timestamp");

            var payloadNames = PresentPayloadNames(source);
            var expectedPayload = ExpectedPayload(source.Kind);
            if (expectedPayload == null)
                return Fail(source, AvatarContractFailureCode.UnknownKind, "不支持 Avatar 下行 kind: " + source.Kind);
            if (expectedPayload.Length == 0)
            {
                if (payloadNames.Count != 0)
                    return Fail(source, AvatarContractFailureCode.MismatchedPayload, source.Kind + " 不允许携带 payload");
            }
            else if (payloadNames.Count == 0)
            {
                return Fail(source, AvatarContractFailureCode.MissingPayload, source.Kind + " 缺少 " + expectedPayload);
            }
            else if (payloadNames.Count != 1 || !string.Equals(payloadNames[0], expectedPayload, StringComparison.Ordinal))
            {
                return Fail(source, AvatarContractFailureCode.MismatchedPayload, source.Kind + " 的 payload 与 kind 不匹配");
            }

            switch (source.Kind)
            {
                case "shutdown": return AvatarContractReadResult.Success(new ShutdownAvatarCommand(), false, source);
                case "ping": return AvatarContractReadResult.Success(null, true, source);
                case "idle": return AvatarContractReadResult.Success(new PlayIdleAvatarCommand(), false, source);
                case "emotion": return MapEmotion(source);
                case "thought": return MapThought(source);
                case "audio_play": return MapAudio(source);
                case "expression": return MapExpression(source);
                case "motion": return MapMotion(source);
                case "lip_sync": return MapLipSync(source);
                case "parameter": return MapParameter(source);
                case "avatar_intent": return MapIntent(source);
                case "presentation": return AvatarContractReadResult.Success(new SetAvatarPresentationCommand(source.Presentation.PlacementId, source.Presentation.DisplayScale, source.Presentation.ResetPlacement), false, source);
                case "character_presentation_projection": return MapCharacterPresentation(source);
                case "load_scene": return MapLoadScene(source);
                case "unload_scene": return AvatarContractReadResult.Success(new UnloadAvatarSceneCommand(), false, source);
                default: return Fail(source, AvatarContractFailureCode.UnknownKind, "不支持 Avatar 下行 kind: " + source.Kind);
            }
        }

        public static string SerializeHostEvent(AvatarHostEvent source, string traceId, double timestamp)
        {
            if (source == null) throw new ArgumentNullException(nameof(source));
            ValidateTimestamp(timestamp);
            var target = new Contract.AvatarUpstreamFrame { TraceId = traceId ?? string.Empty, Timestamp = timestamp };
            switch (source)
            {
                case AvatarHostStarted value:
                    target.Kind = "host_hello";
                    target.HostHello = new Contract.AvatarHostHelloPayload
                    {
                        HostKind = "unity", HostId = value.HostId, HostVersion = value.HostVersion,
                        ModelId = value.ModelId, AvatarPackageId = value.AvatarPackageId,
                    };
                    foreach (var capability in value.Capabilities) target.HostHello.Capabilities.Add(ToWireCapability(capability));
                    break;
                case AvatarHostBecameReady value:
                    target.Kind = "host_ready";
                    target.HostReady = new Contract.AvatarHostReadyPayload
                    {
                        HostId = value.HostId, ModelId = value.ModelId, AvatarPackageId = value.AvatarPackageId,
                        WorkerWindowState = ToWireWorkerState(value.WorkerWindowState),
                        CompositionSurfaceState = ToWireSurfaceState(value.CompositionSurfaceState),
                        FirstFramePresented = value.FirstFramePresented, InteractionReady = value.InteractionReady,
                        Summary = value.Summary,
                    };
                    break;
                case AvatarActionStateChanged value:
                    target.Kind = "avatar_action_state";
                    target.AvatarActionState = new Contract.AvatarActionStatePayload
                    {
                        ActionId = value.ActionId,
                        State = value.State.HasValue ? ToWireActionState(value.State.Value) : string.Empty,
                        Message = value.Message,
                    };
                    target.AvatarActionState.ActiveActionIds.Add(value.ActiveActionIds);
                    break;
                case AvatarAnimationCompleted value:
                    RequireText(value.AnimationId, "animation_complete.animation_id");
                    target.Kind = "animation_complete";
                    target.AnimationComplete = new Contract.AnimationCompletePayload { AnimationId = value.AnimationId };
                    break;
                case AvatarHostFailed value:
                    RequireText(value.Code, "error.code");
                    RequireText(value.Message, "error.message");
                    target.Kind = "error";
                    target.Error = new Contract.AvatarHostErrorPayload { Code = value.Code, Message = value.Message };
                    break;
                default:
                    throw new AvatarContractSerializationException(AvatarContractFailureCode.UnknownKind, "不支持的 Avatar Host event: " + source.GetType().FullName);
            }
            return Formatter.Format(target);
        }

        public static string SerializePong(string traceId, double timestamp)
        {
            ValidateTimestamp(timestamp);
            return Formatter.Format(new Contract.AvatarUpstreamFrame { Kind = "pong", TraceId = traceId ?? string.Empty, Timestamp = timestamp });
        }

        private static AvatarContractReadResult MapEmotion(Contract.AvatarDownstreamFrame source)
        {
            if (!source.Emotion.HasEmotionType || string.IsNullOrWhiteSpace(source.Emotion.EmotionType) || !source.Emotion.HasIntensity)
                return MissingRequired(source, "emotion.emotion_type/intensity");
            return AvatarContractReadResult.Success(new SetAvatarEmotionCommand(source.Emotion.EmotionType, source.Emotion.Intensity), false, source);
        }

        private static AvatarContractReadResult MapThought(Contract.AvatarDownstreamFrame source)
        {
            if (!source.Thought.HasActive) return MissingRequired(source, "thought.active");
            return AvatarContractReadResult.Success(new SetAvatarThoughtCommand(source.Thought.Active), false, source);
        }

        private static AvatarContractReadResult MapAudio(Contract.AvatarDownstreamFrame source)
        {
            if (!source.AudioPlay.HasAudioId || string.IsNullOrWhiteSpace(source.AudioPlay.AudioId)) return MissingRequired(source, "audio_play.audio_id");
            return AvatarContractReadResult.Success(new PlayAvatarAudioCommand(source.AudioPlay.AudioId, source.AudioPlay.AudioUri, source.AudioPlay.AudioData), false, source);
        }

        private static AvatarContractReadResult MapExpression(Contract.AvatarDownstreamFrame source)
        {
            if (!source.Expression.HasExpressionId || string.IsNullOrWhiteSpace(source.Expression.ExpressionId)) return MissingRequired(source, "expression.expression_id");
            return AvatarContractReadResult.Success(new SetAvatarExpressionCommand(source.Expression.ExpressionId), false, source);
        }

        private static AvatarContractReadResult MapMotion(Contract.AvatarDownstreamFrame source)
        {
            if (!source.Motion.HasMotionId || string.IsNullOrWhiteSpace(source.Motion.MotionId)) return MissingRequired(source, "motion.motion_id");
            return AvatarContractReadResult.Success(new PlayAvatarMotionCommand(source.Motion.MotionId, source.Motion.Loop, source.Motion.Priority), false, source);
        }

        private static AvatarContractReadResult MapLipSync(Contract.AvatarDownstreamFrame source)
        {
            if (!source.LipSync.HasAmplitude) return MissingRequired(source, "lip_sync.amplitude");
            if (!string.IsNullOrEmpty(source.LipSync.Source) && source.LipSync.Source != "audio" && source.LipSync.Source != "manual")
                return UnknownEnum(source, "lip_sync.source", source.LipSync.Source);
            return AvatarContractReadResult.Success(new SetAvatarLipSyncCommand(source.LipSync.Amplitude), false, source);
        }

        private static AvatarContractReadResult MapParameter(Contract.AvatarDownstreamFrame source)
        {
            if (!source.Parameter.HasParamId || string.IsNullOrWhiteSpace(source.Parameter.ParamId) || !source.Parameter.HasValue)
                return MissingRequired(source, "parameter.param_id/value");
            return AvatarContractReadResult.Success(new SetAvatarParameterCommand(source.Parameter.ParamId, source.Parameter.Value), false, source);
        }

        private static AvatarContractReadResult MapIntent(Contract.AvatarDownstreamFrame source)
        {
            var value = source.AvatarIntent;
            if (!value.HasActionId || string.IsNullOrWhiteSpace(value.ActionId) || !value.HasOperation || !value.HasSource)
                return MissingRequired(source, "avatar_intent.action_id/operation/source");
            if (!TryParseActionOperation(value.Operation, out var operation)) return UnknownEnum(source, "avatar_intent.operation", value.Operation);
            if (!TryParseActionSource(value.Source, out var actionSource)) return UnknownEnum(source, "avatar_intent.source", value.Source);
            return AvatarContractReadResult.Success(new ExecuteAvatarActionCommand(value.ActionId, operation, actionSource, value.Priority), false, source);
        }

        private static AvatarContractReadResult MapCharacterPresentation(Contract.AvatarDownstreamFrame source)
        {
            var value = source.CharacterPresentationProjection;
            if (!value.HasAvatarPackageId || string.IsNullOrWhiteSpace(value.AvatarPackageId)
                || !value.HasModelId || string.IsNullOrWhiteSpace(value.ModelId)
                || !value.HasDisplayName || string.IsNullOrWhiteSpace(value.DisplayName)
                || !value.HasKind || !value.HasBackend || !value.HasHostKind || !value.HasAvatarState
                || value.Appearance == null || value.Lifecycle == null || !value.Appearance.HasDisplayScale)
                return MissingRequired(source, "character_presentation_projection required fields");
            if (value.Kind != "live2d") return UnknownEnum(source, "character_presentation_projection.kind", value.Kind);
            if (value.Backend != "unity") return UnknownEnum(source, "character_presentation_projection.backend", value.Backend);
            if (value.HostKind != "unity" && value.HostKind != "offline") return UnknownEnum(source, "character_presentation_projection.host_kind", value.HostKind);
            if (value.AvatarState != "pending" && value.AvatarState != "starting" && value.AvatarState != "ready" && value.AvatarState != "degraded" && value.AvatarState != "stopped")
                return UnknownEnum(source, "character_presentation_projection.avatar_state", value.AvatarState);
            var lifecycle = value.Lifecycle;
            if (!lifecycle.HasWorkerWindowState || !lifecycle.HasCompositionSurfaceState || !lifecycle.HasFirstFramePresented
                || !lifecycle.HasInteractionReady || !lifecycle.HasReady || !lifecycle.HasSummary)
                return MissingRequired(source, "character_presentation_projection.lifecycle required fields");
            if (lifecycle.WorkerWindowState != "isolated" && lifecycle.WorkerWindowState != "visible" && lifecycle.WorkerWindowState != "unknown")
                return UnknownEnum(source, "character_presentation_projection.lifecycle.worker_window_state", lifecycle.WorkerWindowState);
            if (lifecycle.CompositionSurfaceState != "attached" && lifecycle.CompositionSurfaceState != "failed" && lifecycle.CompositionSurfaceState != "unknown")
                return UnknownEnum(source, "character_presentation_projection.lifecycle.composition_surface_state", lifecycle.CompositionSurfaceState);
            return AvatarContractReadResult.Success(new ApplyCharacterPresentationCommand(value.Appearance.PlacementId, value.Appearance.DisplayScale), false, source);
        }

        private static AvatarContractReadResult MapLoadScene(Contract.AvatarDownstreamFrame source)
        {
            if (!source.LoadScene.HasSceneId || string.IsNullOrWhiteSpace(source.LoadScene.SceneId)) return MissingRequired(source, "load_scene.scene_id");
            return AvatarContractReadResult.Success(new LoadAvatarSceneCommand(source.LoadScene.SceneId), false, source);
        }

        private static List<string> PresentPayloadNames(Contract.AvatarDownstreamFrame source)
        {
            var names = new List<string>();
            if (source.Emotion != null) names.Add("emotion");
            if (source.Thought != null) names.Add("thought");
            if (source.AudioPlay != null) names.Add("audio_play");
            if (source.Expression != null) names.Add("expression");
            if (source.Motion != null) names.Add("motion");
            if (source.LipSync != null) names.Add("lip_sync");
            if (source.Parameter != null) names.Add("parameter");
            if (source.AvatarIntent != null) names.Add("avatar_intent");
            if (source.Presentation != null) names.Add("presentation");
            if (source.CharacterPresentationProjection != null) names.Add("character_presentation_projection");
            if (source.LoadScene != null) names.Add("load_scene");
            if (source.UnloadScene != null) names.Add("unload_scene");
            return names;
        }

        private static string ExpectedPayload(string kind)
        {
            switch (kind)
            {
                case "shutdown": case "ping": case "idle": return string.Empty;
                case "emotion": case "thought": case "audio_play": case "expression": case "motion":
                case "lip_sync": case "parameter": case "avatar_intent": case "presentation":
                case "character_presentation_projection": case "load_scene": case "unload_scene": return kind;
                default: return null;
            }
        }

        private static AvatarContractReadResult MissingRequired(Contract.AvatarDownstreamFrame source, string field) =>
            Fail(source, AvatarContractFailureCode.MissingRequiredField, "Avatar 下行帧缺少必填字段: " + field);
        private static AvatarContractReadResult UnknownEnum(Contract.AvatarDownstreamFrame source, string field, string value) =>
            Fail(source, AvatarContractFailureCode.UnknownEnum, "Avatar 下行帧包含未知枚举 " + field + ": " + value);
        private static AvatarContractReadResult Fail(Contract.AvatarDownstreamFrame source, AvatarContractFailureCode code, string message) =>
            AvatarContractReadResult.Fail(code, message, source?.TraceId);

        private static bool TryParseActionOperation(string value, out AvatarActionOperation operation)
        {
            switch (value)
            {
                case "trigger": operation = AvatarActionOperation.Trigger; return true;
                case "activate": operation = AvatarActionOperation.Activate; return true;
                case "deactivate": operation = AvatarActionOperation.Deactivate; return true;
                default: operation = default; return false;
            }
        }

        private static bool TryParseActionSource(string value, out AvatarActionSource source)
        {
            switch (value)
            {
                case "user": source = AvatarActionSource.User; return true;
                case "cognition": source = AvatarActionSource.Cognition; return true;
                case "system": source = AvatarActionSource.System; return true;
                case "extension": source = AvatarActionSource.Extension; return true;
                default: source = default; return false;
            }
        }

        private static string ToWireCapability(AvatarHostCapability value)
        {
            switch (value)
            {
                case AvatarHostCapability.Expression: return "expression";
                case AvatarHostCapability.Motion: return "motion";
                case AvatarHostCapability.AvatarIntent: return "avatar_intent";
                case AvatarHostCapability.LipSync: return "lip_sync";
                case AvatarHostCapability.Parameter: return "parameter";
                case AvatarHostCapability.AudioPlay: return "audio_play";
                case AvatarHostCapability.LoadScene: return "load_scene";
                default: throw new AvatarContractSerializationException(AvatarContractFailureCode.UnknownEnum, "未知 Avatar capability: " + value);
            }
        }

        private static string ToWireWorkerState(AvatarWorkerWindowState value)
        {
            switch (value)
            {
                case AvatarWorkerWindowState.Isolated: return "isolated";
                case AvatarWorkerWindowState.Visible: return "visible";
                case AvatarWorkerWindowState.Unknown: return "unknown";
                default: throw new AvatarContractSerializationException(AvatarContractFailureCode.UnknownEnum, "未知 worker window state: " + value);
            }
        }

        private static string ToWireSurfaceState(AvatarCompositionSurfaceState value)
        {
            switch (value)
            {
                case AvatarCompositionSurfaceState.Attached: return "attached";
                case AvatarCompositionSurfaceState.Failed: return "failed";
                case AvatarCompositionSurfaceState.Unknown: return "unknown";
                default: throw new AvatarContractSerializationException(AvatarContractFailureCode.UnknownEnum, "未知 composition surface state: " + value);
            }
        }

        private static string ToWireActionState(AvatarActionExecutionState value)
        {
            switch (value)
            {
                case AvatarActionExecutionState.Inactive: return "inactive";
                case AvatarActionExecutionState.Active: return "active";
                case AvatarActionExecutionState.Running: return "running";
                case AvatarActionExecutionState.Completed: return "completed";
                case AvatarActionExecutionState.Rejected: return "rejected";
                default: throw new AvatarContractSerializationException(AvatarContractFailureCode.UnknownEnum, "未知 action state: " + value);
            }
        }

        private static void ValidateTimestamp(double timestamp)
        {
            if (double.IsNaN(timestamp) || double.IsInfinity(timestamp))
                throw new AvatarContractSerializationException(AvatarContractFailureCode.MissingRequiredField, "timestamp 必须是有限数值");
        }

        private static void RequireText(string value, string field)
        {
            if (string.IsNullOrWhiteSpace(value))
                throw new AvatarContractSerializationException(AvatarContractFailureCode.MissingRequiredField, field + " 不能为空");
        }
    }
}
