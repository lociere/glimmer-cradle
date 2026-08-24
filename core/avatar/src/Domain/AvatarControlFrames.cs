using System;

namespace GlimmerCradle.Avatar
{
    public sealed class EmotionPayload { public string emotion_type = ""; public float intensity; public string trigger = ""; public int blend_time_ms; }
    public sealed class ThoughtPayload { public bool active; public string hint = ""; }
    public sealed class AudioPlayPayload { public string audio_id = ""; public string audio_uri = ""; public string audio_data = ""; public string mime_type = ""; public int duration_ms; }
    public sealed class AvatarExpressionPayload { public string expression_id = ""; public int blend_time_ms; public bool auto_reset; }
    public sealed class AvatarMotionPayload { public string motion_id = ""; public bool loop; public int priority; }
    public sealed class AvatarLipSyncPayload { public float amplitude; public string source = ""; }
    public sealed class AvatarParameterPayload { public string param_id = ""; public float value; public int fade_ms; }
    public sealed class AvatarIntentPayload { public string action_id = ""; public string operation = ""; public string source = ""; public int priority; }
    public sealed class AvatarActionStatePayload { public string action_id = ""; public string state = ""; public string[] active_action_ids = Array.Empty<string>(); public string message = ""; }
    public sealed class AvatarPresentationPayload { public string placement_id = ""; public float display_scale; public bool reset_placement; }
    public sealed class CharacterPresentationAppearancePayload { public string placement_id = ""; public float display_scale; }
    public sealed class CharacterPresentationLifecyclePayload
    {
        public string worker_window_state = "";
        public string composition_surface_state = "";
        public bool first_frame_presented;
        public bool interaction_ready;
        public bool ready;
        public string summary = "";
    }
    public sealed class CharacterPresentationProjectionPayload
    {
        public string avatar_package_id = "";
        public string model_id = "";
        public string display_name = "";
        public string kind = "";
        public string backend = "";
        public string host_kind = "";
        public string avatar_state = "";
        public CharacterPresentationAppearancePayload appearance;
        public CharacterPresentationLifecyclePayload lifecycle;
    }
    public sealed class LoadScenePayload { public string scene_id = ""; public int fade_ms; }
    public sealed class UnloadScenePayload { public int fade_ms; }

    public sealed class AvatarDownstreamFrame
    {
        public string kind = "";
        public string trace_id = "";
        public double timestamp;
        public EmotionPayload emotion;
        public ThoughtPayload thought;
        public AudioPlayPayload audio_play;
        public AvatarExpressionPayload expression;
        public AvatarMotionPayload motion;
        public AvatarLipSyncPayload lip_sync;
        public AvatarParameterPayload parameter;
        public AvatarIntentPayload avatar_intent;
        public AvatarPresentationPayload presentation;
        public CharacterPresentationProjectionPayload character_presentation_projection;
        public LoadScenePayload load_scene;
        public UnloadScenePayload unload_scene;
    }

    public sealed class AvatarHostHelloPayload
    {
        public string host_kind = ""; public string host_id = ""; public string host_version = "";
        public string[] capabilities = Array.Empty<string>(); public string model_id = ""; public string avatar_package_id = "";
    }
    public sealed class AvatarHostReadyPayload
    {
        public string host_id = ""; public string model_id = ""; public string avatar_package_id = "";
        public string worker_window_state = ""; public string composition_surface_state = "";
        public bool first_frame_presented; public bool interaction_ready; public string summary = "";
    }
    public sealed class AnimationCompletePayload { public string animation_id = ""; }
    public sealed class AvatarHostErrorPayload { public string code = ""; public string message = ""; }
    public sealed class AvatarUpstreamFrame
    {
        public string kind = ""; public string trace_id = ""; public double timestamp;
        public AvatarHostHelloPayload host_hello; public AvatarHostReadyPayload host_ready;
        public AvatarActionStatePayload avatar_action_state; public AnimationCompletePayload animation_complete;
        public AvatarHostErrorPayload error;
    }
}
