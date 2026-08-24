using System;
using Google.Protobuf;
using Contract = GlimmerCradle.Contracts.Glimmer.Avatar.V1;
using GlimmerCradle.Avatar;

namespace GlimmerCradle.UnityAvatarHost.Adapters
{
    public static class AvatarContractAdapter
    {
        private static readonly JsonParser Parser = new JsonParser(
            JsonParser.Settings.Default.WithIgnoreUnknownFields(true));
        private static readonly JsonFormatter Formatter = new JsonFormatter(
            JsonFormatter.Settings.Default.WithPreserveProtoFieldNames(true));

        public static AvatarDownstreamFrame DeserializeDownstream(string json)
        {
            var source = Parser.Parse<Contract.AvatarDownstreamFrame>(json);
            return new AvatarDownstreamFrame
            {
                kind = source.Kind,
                trace_id = source.TraceId,
                timestamp = source.Timestamp,
                emotion = source.Emotion == null ? null : new EmotionPayload { emotion_type = source.Emotion.EmotionType, intensity = source.Emotion.Intensity, trigger = source.Emotion.Trigger, blend_time_ms = source.Emotion.BlendTimeMs },
                thought = source.Thought == null ? null : new ThoughtPayload { active = source.Thought.Active, hint = source.Thought.Hint },
                audio_play = source.AudioPlay == null ? null : new AudioPlayPayload { audio_id = source.AudioPlay.AudioId, audio_uri = source.AudioPlay.AudioUri, audio_data = source.AudioPlay.AudioData, mime_type = source.AudioPlay.MimeType, duration_ms = source.AudioPlay.DurationMs },
                expression = source.Expression == null ? null : new AvatarExpressionPayload { expression_id = source.Expression.ExpressionId, blend_time_ms = source.Expression.BlendTimeMs, auto_reset = source.Expression.AutoReset },
                motion = source.Motion == null ? null : new AvatarMotionPayload { motion_id = source.Motion.MotionId, loop = source.Motion.Loop, priority = source.Motion.Priority },
                lip_sync = source.LipSync == null ? null : new AvatarLipSyncPayload { amplitude = source.LipSync.Amplitude, source = source.LipSync.Source },
                parameter = source.Parameter == null ? null : new AvatarParameterPayload { param_id = source.Parameter.ParamId, value = source.Parameter.Value, fade_ms = source.Parameter.FadeMs },
                avatar_intent = source.AvatarIntent == null ? null : new AvatarIntentPayload { action_id = source.AvatarIntent.ActionId, operation = source.AvatarIntent.Operation, source = source.AvatarIntent.Source, priority = source.AvatarIntent.Priority },
                presentation = source.Presentation == null ? null : new AvatarPresentationPayload { placement_id = source.Presentation.PlacementId, display_scale = source.Presentation.DisplayScale, reset_placement = source.Presentation.ResetPlacement },
                character_presentation_projection = Map(source.CharacterPresentationProjection),
                load_scene = source.LoadScene == null ? null : new LoadScenePayload { scene_id = source.LoadScene.SceneId, fade_ms = source.LoadScene.FadeMs },
                unload_scene = source.UnloadScene == null ? null : new UnloadScenePayload { fade_ms = source.UnloadScene.FadeMs },
            };
        }

        public static string SerializeUpstream(AvatarUpstreamFrame source)
        {
            if (source == null) throw new ArgumentNullException(nameof(source));
            var target = new Contract.AvatarUpstreamFrame
            {
                Kind = source.kind ?? "",
                TraceId = source.trace_id ?? "",
                Timestamp = source.timestamp,
                HostHello = source.host_hello == null ? null : new Contract.AvatarHostHelloPayload
                {
                    HostKind = source.host_hello.host_kind ?? "", HostId = source.host_hello.host_id ?? "",
                    HostVersion = source.host_hello.host_version ?? "", ModelId = source.host_hello.model_id ?? "",
                    AvatarPackageId = source.host_hello.avatar_package_id ?? "",
                },
                HostReady = source.host_ready == null ? null : new Contract.AvatarHostReadyPayload
                {
                    HostId = source.host_ready.host_id ?? "", ModelId = source.host_ready.model_id ?? "",
                    AvatarPackageId = source.host_ready.avatar_package_id ?? "", WorkerWindowState = source.host_ready.worker_window_state ?? "",
                    CompositionSurfaceState = source.host_ready.composition_surface_state ?? "", FirstFramePresented = source.host_ready.first_frame_presented,
                    InteractionReady = source.host_ready.interaction_ready, Summary = source.host_ready.summary ?? "",
                },
                AvatarActionState = source.avatar_action_state == null ? null : new Contract.AvatarActionStatePayload
                {
                    ActionId = source.avatar_action_state.action_id ?? "", State = source.avatar_action_state.state ?? "", Message = source.avatar_action_state.message ?? "",
                },
                AnimationComplete = source.animation_complete == null ? null : new Contract.AnimationCompletePayload { AnimationId = source.animation_complete.animation_id ?? "" },
                Error = source.error == null ? null : new Contract.AvatarHostErrorPayload { Code = source.error.code ?? "", Message = source.error.message ?? "" },
            };
            if (source.host_hello?.capabilities != null) target.HostHello.Capabilities.Add(source.host_hello.capabilities);
            if (source.avatar_action_state?.active_action_ids != null) target.AvatarActionState.ActiveActionIds.Add(source.avatar_action_state.active_action_ids);
            return Formatter.Format(target);
        }

        private static CharacterPresentationProjectionPayload Map(Contract.CharacterPresentationProjectionPayload source)
        {
            if (source == null) return null;
            return new CharacterPresentationProjectionPayload
            {
                avatar_package_id = source.AvatarPackageId, model_id = source.ModelId, display_name = source.DisplayName,
                kind = source.Kind, backend = source.Backend, host_kind = source.HostKind, avatar_state = source.AvatarState,
                appearance = source.Appearance == null ? null : new CharacterPresentationAppearancePayload { placement_id = source.Appearance.PlacementId, display_scale = source.Appearance.DisplayScale },
                lifecycle = source.Lifecycle == null ? null : new CharacterPresentationLifecyclePayload
                {
                    worker_window_state = source.Lifecycle.WorkerWindowState, composition_surface_state = source.Lifecycle.CompositionSurfaceState,
                    first_frame_presented = source.Lifecycle.FirstFramePresented, interaction_ready = source.Lifecycle.InteractionReady,
                    ready = source.Lifecycle.Ready, summary = source.Lifecycle.Summary,
                },
            };
        }
    }
}
