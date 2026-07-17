import { describe, expect, it } from 'vitest';
import { AudioService } from './audio-service';

describe('AudioService readiness projection', () => {
  it('emits an aggregate audio.host reconciler ahead of per-lane snapshots', () => {
    const service = AudioService.instance as unknown as {
      audioConfig: { tts: { enabled: boolean }; asr: { enabled: boolean } };
      ttsReadiness: { status: 'disabled' | 'unknown' | 'ready' | 'degraded' | 'unavailable'; message?: string };
      asrReadiness: { status: 'disabled' | 'unknown' | 'ready' | 'degraded' | 'unavailable'; message?: string };
    };

    service.audioConfig = { tts: { enabled: true }, asr: { enabled: true } };
    service.ttsReadiness = { status: 'ready' };
    service.asrReadiness = { status: 'unavailable', message: 'ASR 模型缺失' };

    const snapshots = AudioService.instance.getReadinessSnapshots();

    expect(snapshots[0]).toMatchObject({
      runtime_id: 'audio.host',
      owner: 'engine',
      phase: 'capability_plane',
      state: 'degraded',
      reconciler: {
        desired: 'audio-ready',
        readiness: 'degraded',
      },
    });
    expect(snapshots[0].reconciler?.resources).toEqual([
      expect.objectContaining({
        resource_id: 'audio.tts',
        resource_kind: 'audio_lane',
        readiness: 'ready',
      }),
      expect.objectContaining({
        resource_id: 'audio.asr',
        resource_kind: 'audio_lane',
        readiness: 'degraded',
      }),
    ]);
    expect(snapshots.slice(1).map((snapshot) => snapshot.runtime_id))
      .toEqual(['audio.tts', 'audio.asr']);
  });

  it('treats disabled audio enhancements as a ready baseline', () => {
    const service = AudioService.instance as unknown as {
      audioConfig: { tts: { enabled: boolean }; asr: { enabled: boolean } };
      ttsReadiness: { status: 'disabled'; message?: string };
      asrReadiness: { status: 'disabled'; message?: string };
    };
    service.audioConfig = { tts: { enabled: false }, asr: { enabled: false } };
    service.ttsReadiness = { status: 'disabled' };
    service.asrReadiness = { status: 'disabled' };

    expect(AudioService.instance.getReadinessSnapshots()[0]).toMatchObject({
      runtime_id: 'audio.host',
      state: 'ready',
      summary: '语音增强未启用，基础运行形态保持就绪',
      reconciler: { readiness: 'ready' },
    });
  });

  it('publishes a ready TTS lane without waiting for ASR warmup', async () => {
    const service = AudioService.instance as unknown as {
      cachedStatus: {
        updated_at: number;
        tts: Record<string, unknown>;
        asr: Record<string, unknown>;
      };
      ttsReadiness: { status: 'disabled' | 'unknown' | 'ready' | 'degraded' | 'unavailable'; message?: string };
      asrReadiness: { status: 'disabled' | 'unknown' | 'ready' | 'degraded' | 'unavailable'; message?: string };
      prepareLane: (lane: 'tts' | 'asr', warmup: Promise<Record<string, unknown>>) => Promise<void>;
    };
    service.cachedStatus = {
      updated_at: Date.now(),
      tts: {
        enabled: true,
        route_state: 'unknown',
        providers: [],
      },
      asr: {
        enabled: true,
        route_state: 'unknown',
        providers: [],
      },
    };
    service.ttsReadiness = { status: 'unknown' };
    service.asrReadiness = { status: 'unknown' };
    const projections: string[] = [];
    const unsubscribe = AudioService.instance.subscribeStatus((status) => {
      projections.push(status.tts.route_state);
    });

    await service.prepareLane('tts', Promise.resolve({
      id: 'tts-warmup',
      status: 'success',
      payload: {
        route_state: 'ready',
        active_provider: 'dashscope-cosyvoice',
        providers: [{
          provider_id: 'dashscope-cosyvoice',
          role: 'primary',
          execution: 'cloud',
          status: 'ready',
        }],
      },
    }));
    unsubscribe();

    expect(AudioService.instance.getCachedStatus()).toMatchObject({
      tts: { route_state: 'ready', active_provider: 'dashscope-cosyvoice' },
      asr: { route_state: 'unknown' },
    });
    expect(projections).toContain('ready');
  });
});
