using System;
using System.Collections.Generic;

namespace GlimmerCradle.Avatar
{
    public static class AvatarFrameClassifier
    {
        private static readonly HashSet<string> SupportedKinds = new HashSet<string>(StringComparer.Ordinal)
        {
            "shutdown", "ping", "emotion", "expression", "motion", "lip_sync", "parameter",
            "avatar_intent", "presentation", "character_presentation_projection", "audio_play",
            "thought", "idle", "load_scene", "unload_scene",
        };

        public static bool IsSupported(AvatarDownstreamFrame frame)
        {
            return frame != null && SupportedKinds.Contains(frame.kind ?? "");
        }
    }
}
