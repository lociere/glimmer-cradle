import fs from 'fs-extra';
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AudioConfig } from '../config/documents';
import type { VoiceConfig } from '../config/documents/VoiceConfig';
import { resolveWorkPath } from '../filesystem/path-utils';
import { stopManagedProcess } from '../process/process-supervisor';
import { OfficialAudioEngineClient } from './official-audio-engine';

const audioConfig: AudioConfig = {
  tts: {
    enabled: true,
    route: {
      primary: 'dashscope-cosyvoice',
      fallbacks: [],
      circuit_breaker: { failure_threshold: 3, recovery_timeout_ms: 30_000 },
    },
    cache: { enabled: true, max_age_days: 7 },
    providers: {
      'dashscope-cosyvoice': {
        enabled: true,
        endpoint: 'wss://example.invalid/audio',
        model: 'test-model',
        format: 'wav',
        sample_rate: 24_000,
        connect_timeout_ms: 100,
        receive_timeout_ms: 100,
        max_retries: 0,
      },
    },
  },
  asr: { enabled: false, provider: 'funasr', resource_id: 'funasr.sensevoice-small' },
};

const voiceConfig: VoiceConfig = {
  profile_id: 'test',
  language: 'zh-CN',
  style_instruction: '',
  prosody: { rate: 1, pitch: 1, volume: 50 },
  bindings: { 'dashscope-cosyvoice': { voice_id: '' } },
};

function createClient(): OfficialAudioEngineClient {
  const client = new OfficialAudioEngineClient(
    'tts',
    path.resolve(__dirname, '../../../../../engines/audio'),
    20_000,
  );
  client.configure({ audioConfig, voiceConfig, secrets: {} });
  return client;
}

describe('OfficialAudioEngineClient gRPC lifecycle', () => {
  it('uses the dynamic loopback endpoint and removes the lane lease root on shutdown', async () => {
    const client = createClient();

    const health = await client.health();
    expect(health.status).toBe('success');
    expect((health.payload?.providers as Record<string, unknown>).tts).toBeTruthy();

    await client.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await fs.pathExists(resolveWorkPath(path.join('audio', 'media-leases', 'tts')))).toBe(false);
  }, 30_000);

  it('removes all lane leases when the managed host is forcibly terminated', async () => {
    const client = createClient();
    await client.health();
    const mediaRoot = resolveWorkPath(path.join('audio', 'media-leases', 'tts'));
    await fs.outputFile(path.join(mediaRoot, 'orphaned', 'input.wav'), 'orphaned');
    const child = (client as unknown as { process: ChildProcess }).process;
    await stopManagedProcess(child, { label: 'Audio gRPC lifecycle test host' });
    for (let attempt = 0; attempt < 50 && await fs.pathExists(mediaRoot); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await fs.pathExists(mediaRoot)).toBe(false);
  }, 30_000);

  it('reuses one host for a bounded control-plane soak without leaking leases', async () => {
    const client = createClient();
    try {
      await client.health();
      const initialPid = (client as unknown as { process: ChildProcess }).process.pid;
      const startedAt = performance.now();
      for (let request = 0; request < 64; request += 1) {
        expect((await client.health()).status).toBe('success');
      }
      expect((client as unknown as { process: ChildProcess }).process.pid).toBe(initialPid);
      expect(performance.now() - startedAt).toBeLessThan(10_000);
    } finally {
      await client.stop();
    }
    expect(await fs.pathExists(resolveWorkPath(path.join('audio', 'media-leases', 'tts')))).toBe(false);
  }, 30_000);
});
