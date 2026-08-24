using System;

namespace GlimmerCradle.Avatar
{
    public static class AvatarCommandDispatcher
    {
        public static void Dispatch(AvatarCommand command, IAvatarCommandSink sink)
        {
            if (command == null) throw new ArgumentNullException(nameof(command));
            if (sink == null) throw new ArgumentNullException(nameof(sink));

            switch (command)
            {
                case ShutdownAvatarCommand value: sink.Shutdown(value); break;
                case SetAvatarEmotionCommand value: sink.ApplyEmotion(value); break;
                case SetAvatarExpressionCommand value: sink.ApplyExpression(value); break;
                case PlayAvatarMotionCommand value: sink.PlayMotion(value); break;
                case SetAvatarLipSyncCommand value: sink.ApplyLipSync(value); break;
                case SetAvatarParameterCommand value: sink.ApplyParameter(value); break;
                case ExecuteAvatarActionCommand value: sink.ApplyIntent(value); break;
                case SetAvatarPresentationCommand value: sink.ApplyPresentation(value); break;
                case ApplyCharacterPresentationCommand value: sink.ApplyCharacterPresentation(value); break;
                case PlayAvatarAudioCommand value: sink.PlayAudio(value); break;
                case SetAvatarThoughtCommand value: sink.ApplyThought(value); break;
                case PlayIdleAvatarCommand value: sink.PlayIdle(value); break;
                case LoadAvatarSceneCommand value: sink.LoadScene(value); break;
                case UnloadAvatarSceneCommand value: sink.UnloadScene(value); break;
                default: throw new ArgumentOutOfRangeException(nameof(command), command.GetType().FullName, "不支持的 Avatar 命令类型");
            }
        }
    }
}
