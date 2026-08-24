using System;

namespace GlimmerCradle.Avatar
{
    public static class AvatarFrameDispatcher
    {
        public static bool TryDispatch(AvatarDownstreamFrame frame, IAvatarCommandSink sink)
        {
            if (frame == null)
            {
                throw new ArgumentNullException(nameof(frame));
            }

            if (sink == null)
            {
                throw new ArgumentNullException(nameof(sink));
            }

            switch (frame.kind)
            {
                case "shutdown": sink.Shutdown(); break;
                case "emotion": sink.ApplyEmotion(frame.emotion); break;
                case "expression": sink.ApplyExpression(frame.expression); break;
                case "motion": sink.PlayMotion(frame.motion); break;
                case "lip_sync": sink.ApplyLipSync(frame.lip_sync); break;
                case "parameter": sink.ApplyParameter(frame.parameter); break;
                case "avatar_intent": sink.ApplyIntent(frame.avatar_intent); break;
                case "presentation": sink.ApplyPresentation(frame.presentation); break;
                case "character_presentation_projection": sink.ApplyCharacterPresentation(frame.character_presentation_projection); break;
                case "audio_play": sink.PlayAudio(frame.audio_play); break;
                case "thought": sink.ApplyThought(frame.thought); break;
                case "idle": sink.PlayIdle(); break;
                case "load_scene": sink.LoadScene(frame.load_scene); break;
                case "unload_scene": sink.UnloadScene(frame.unload_scene); break;
                default: return false;
            }

            return true;
        }
    }
}
