import { useEffect } from 'react';
import { AudioPlaybackController } from '../audio/audio-playback';
import { useAppStore } from '../store/appStore';
import { useEmotionStore } from '../store/emotionStore';

type AudioStatusPayload = NonNullable<
  Awaited<ReturnType<Window['desktopHost']['getAudioStatus']>>
>;

export function useDesktopHost(): void {
  const appendAssistantReply = useAppStore((s) => s.appendAssistantReply);
  const setSystemStatus = useAppStore((s) => s.setSystemStatus);
  const setAvatarRenderState = useAppStore((s) => s.setAvatarRenderState);
  const setThought = useAppStore((s) => s.setThought);
  const setAudioStatus = useAppStore((s) => s.setAudioStatus);
  const setAudioInput = useAppStore((s) => s.setAudioInput);
  const addUserMessage = useAppStore((s) => s.addUserMessage);
  const setAvatarAppearance = useAppStore((s) => s.setAvatarAppearance);
  const setCharacterPresentationProjection = useAppStore((s) => s.setCharacterPresentationProjection);
  const setRuntimeReadinessCatalog = useAppStore((s) => s.setRuntimeReadinessCatalog);
  const updateEmotion = useEmotionStore((s) => s.updateEmotion);

  const applyAudioStatus = (status: AudioStatusPayload): void => {
    setAudioStatus({
      updatedAt: status.updated_at,
      tts: {
        enabled: status.tts.enabled,
        disabled_reason: status.tts.disabled_reason,
        activeProvider: status.tts.active_provider,
        routeState: status.tts.route_state,
        providers: status.tts.providers,
      },
      asr: {
        enabled: status.asr.enabled,
        disabled_reason: status.asr.disabled_reason,
        activeProvider: status.asr.active_provider,
        routeState: status.asr.route_state,
        providers: status.asr.providers,
      },
    });
  };

  useEffect(() => {
    const api = window.desktopHost;
    if (!api) {
      setSystemStatus('error');
      return;
    }

    const audioPlayback = new AudioPlaybackController();

    void api.getConnectionStatus()
      .then((status) => setSystemStatus(status.status))
      .catch(() => setSystemStatus('error'));

    void api.getAudioStatus()
      .then((status) => {
        if (status) applyAudioStatus(status);
      })
      .catch(() => undefined);

    void api.getRuntimeReadiness()
      .then((catalog) => {
        setRuntimeReadinessCatalog(catalog);
      })
      .catch(() => {
        setRuntimeReadinessCatalog(null);
      });

    void api.getAvatarAppearance()
      .then((appearance) => {
        setAvatarAppearance(appearance);
      })
      .catch(() => undefined);

    void api.getCharacterPresentationProjection()
      .then((projection) => {
        setCharacterPresentationProjection(projection);
      })
      .catch(() => {
        setCharacterPresentationProjection(null);
      });

    const disposeReply = api.onReply((reply) => {
      if (reply.text || reply.messages.length > 0) {
        appendAssistantReply(reply.trace_id, reply.text, reply.messages);
        setThought({ active: false, traceId: reply.trace_id });
      }
    });

    const disposeConnectionStatus = api.onConnectionStatus((status) => {
      setSystemStatus(status.status);
    });

    const disposeEmotionUpdate = api.onEmotionUpdate((emotion) => {
      updateEmotion({
        emotion_type: emotion.emotion_type,
        intensity: emotion.intensity,
        trigger: emotion.trigger,
        timestamp: emotion.timestamp,
      });
    });

    const disposeThoughtUpdate = api.onThoughtUpdate((thought) => {
      setThought({
        active: thought.active,
        traceId: thought.trace_id || undefined,
        hint: thought.hint || undefined,
        updatedAt: Date.parse(thought.timestamp) || Date.now(),
      });
    });

    const disposeAvatarStatus = api.onAvatarStatus((status) => {
      if (status.hostKind === 'unity') {
        setAvatarRenderState('unity');
        return;
      }

      // Kernel 的 avatar_status 是 Avatar 的唯一运行事实；Electron 不再维护第二套身体状态。
      if (useAppStore.getState().avatarRenderState === 'unity') {
        setAvatarRenderState('unity-pending');
      }
    });

    const disposeAudioStatus = api.onAudioStatus((status) => {
      applyAudioStatus(status);
    });

    const disposeRuntimeReadiness = api.onRuntimeReadiness((catalog) => {
      setRuntimeReadinessCatalog(catalog);
    });

    const disposeAudioPlay = api.onAudioPlay((payload) => {
      void audioPlayback.play(payload);
    });

    const disposeAudioTranscript = api.onAudioTranscript((payload) => {
      if (payload.status === 'success' && payload.text?.trim()) {
        addUserMessage(payload.text.trim());
        setAudioInput({ status: 'idle' });
        return;
      }

      setAudioInput({
        status: 'error',
        error: payload.message || '语音识别失败',
      });
    });

    const disposeAvatarAppearance = api.onAvatarAppearance((appearance) => {
      setAvatarAppearance(appearance);
    });

    const disposeCharacterPresentationProjection = api.onCharacterPresentationProjection((projection) => {
      setCharacterPresentationProjection(projection);
    });

    return () => {
      disposeReply();
      disposeConnectionStatus();
      disposeEmotionUpdate();
      disposeThoughtUpdate();
      disposeAvatarStatus();
      disposeAudioStatus();
      disposeRuntimeReadiness();
      disposeAudioPlay();
      disposeAudioTranscript();
      disposeAvatarAppearance();
      disposeCharacterPresentationProjection();
      audioPlayback.dispose();
    };
  }, [
    addUserMessage,
    appendAssistantReply,
    setAvatarAppearance,
    setAudioInput,
    setAudioStatus,
    setAvatarRenderState,
    setCharacterPresentationProjection,
    setRuntimeReadinessCatalog,
    setSystemStatus,
    setThought,
    updateEmotion,
  ]);
}
