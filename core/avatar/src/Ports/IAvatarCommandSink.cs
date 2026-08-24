namespace GlimmerCradle.Avatar
{
    public interface IAvatarCommandSink
    {
        void Shutdown(ShutdownAvatarCommand command);
        void ApplyEmotion(SetAvatarEmotionCommand command);
        void ApplyExpression(SetAvatarExpressionCommand command);
        void PlayMotion(PlayAvatarMotionCommand command);
        void ApplyLipSync(SetAvatarLipSyncCommand command);
        void ApplyParameter(SetAvatarParameterCommand command);
        void ApplyIntent(ExecuteAvatarActionCommand command);
        void ApplyPresentation(SetAvatarPresentationCommand command);
        void ApplyCharacterPresentation(ApplyCharacterPresentationCommand command);
        void PlayAudio(PlayAvatarAudioCommand command);
        void ApplyThought(SetAvatarThoughtCommand command);
        void PlayIdle(PlayIdleAvatarCommand command);
        void LoadScene(LoadAvatarSceneCommand command);
        void UnloadScene(UnloadAvatarSceneCommand command);
    }
}
