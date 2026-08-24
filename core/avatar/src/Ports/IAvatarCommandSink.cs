namespace GlimmerCradle.Avatar
{
    public interface IAvatarCommandSink
    {
        void Shutdown();
        void ApplyEmotion(EmotionPayload payload);
        void ApplyExpression(AvatarExpressionPayload payload);
        void PlayMotion(AvatarMotionPayload payload);
        void ApplyLipSync(AvatarLipSyncPayload payload);
        void ApplyParameter(AvatarParameterPayload payload);
        void ApplyIntent(AvatarIntentPayload payload);
        void ApplyPresentation(AvatarPresentationPayload payload);
        void ApplyCharacterPresentation(CharacterPresentationProjectionPayload payload);
        void PlayAudio(AudioPlayPayload payload);
        void ApplyThought(ThoughtPayload payload);
        void PlayIdle();
        void LoadScene(LoadScenePayload payload);
        void UnloadScene(UnloadScenePayload payload);
    }
}
