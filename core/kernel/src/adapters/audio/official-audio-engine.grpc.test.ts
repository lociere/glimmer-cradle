import fs from 'fs-extra';
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { AudioConfig } from '../../domain/config';
import type { VoiceConfig } from '../config/documents/VoiceConfig';
import { resolveWorkPath } from '../filesystem/path-utils';
import { ManagedProcessSupervisor } from '@glimmer-cradle/platform';
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
    // Make the actual owner take its protocol-failure path; another supervisor has no Job handle.
    const call = vi.spyOn(client as unknown as { call: (...args: unknown[]) => Promise<unknown> }, 'call');
    call.mockRejectedValueOnce(new Error('isolated shutdown transport failure'));
    await client.stop();
    call.mockRestore();
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
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


describe('OfficialAudioEngineClient failed process release', () => {
  it('cleans bootstrap readers after a real missing executable and can start a fresh host', async () => {
    const client = createClient();
    const previousPython = process.env.GLIMMER_CRADLE_PYTHON_RUNTIME;
    const launch = vi.spyOn(ManagedProcessSupervisor.prototype, 'spawnManagedProcess');
    try {
      process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = path.join(require('node:os').tmpdir(), 'glimmer-no-such-audio-python.exe');
      const began = performance.now();
      await expect(client.health()).rejects.toThrow();
      expect(performance.now() - began).toBeLessThan(3000);
      const failedChild = launch.mock.results[0].value as ChildProcess;
      expect(failedChild.stdout?.listenerCount('data')).toBe(0);
      expect((client as unknown as { process: ChildProcess | null }).process).toBeNull();
      if (previousPython === undefined) delete process.env.GLIMMER_CRADLE_PYTHON_RUNTIME;
      else process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = previousPython;
      expect((await client.health()).status).toBe('success');
      await client.stop();
    } finally {
      if (previousPython === undefined) delete process.env.GLIMMER_CRADLE_PYTHON_RUNTIME;
      else process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = previousPython;
      launch.mockRestore();
      await client.stop();
    }
  }, 30_000);

  it('retains the live owner and media on failure, closes ingress and retries one shared stop', async () => {
    const client = createClient();
    const child = Object.assign(new EventEmitter(), { pid: 5252, exitCode: null, signalCode: null }) as unknown as ChildProcess;
    const internals = client as unknown as { process: ChildProcess | null; mediaRoot: string };
    const mediaRoot = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'glimmer-audio-stop-'));
    internals.mediaRoot = mediaRoot;
    internals.process = child;
    await fs.outputFile(path.join(mediaRoot, 'lease', 'input.wav'), 'owned input');
    const stop = vi.spyOn(ManagedProcessSupervisor.prototype, 'stopManagedProcess');
    stop.mockRejectedValueOnce(new Error('kill denied'));
    try {
      const first = client.stop();
      expect(client.stop()).toBe(first);
      await expect(first).rejects.toThrow('kill denied');
      expect(internals.process).toBe(child);
      expect(await fs.pathExists(mediaRoot)).toBe(true);
      await expect(client.health()).rejects.toThrow('回收失败');
      stop.mockImplementationOnce(async () => { Object.assign(child, { exitCode: 0 }); });
      await client.stop();
      expect(internals.process).toBeNull();
      expect(await fs.pathExists(mediaRoot)).toBe(false);
      expect(stop).toHaveBeenCalledTimes(2);
    } finally { stop.mockRestore(); await fs.remove(mediaRoot); }
  });
});
