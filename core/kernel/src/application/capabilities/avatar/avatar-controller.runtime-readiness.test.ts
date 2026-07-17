import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { AvatarConfig } from '@glimmer-cradle/protocol';
import { RuntimeReadinessCatalogStore } from '../../../foundation/runtime-readiness-catalog';
import { AvatarController } from './avatar-controller';

function createUnityAvatarHostConfig(
  overrides: Partial<AvatarConfig> = {},
): AvatarConfig {
  return {
    enabled: true,
    heartbeat_interval_ms: 50,
    heartbeat_timeout_ms: 150,
    host: {
      launch_mode: 'manual',
      command: '',
      args: [],
      cwd: '',
      env: {},
      startup_timeout_ms: 300,
      restart_on_exit: false,
    },
    emotion_mapping: {},
    ...overrides,
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condition not met before timeout');
}

function getAvatarRuntime() {
  return RuntimeReadinessCatalogStore.instance.getCatalog().runtimes.find(
    (runtime) => runtime.runtime_id === 'avatar.host',
  );
}

describe('AvatarController runtime readiness sync', () => {
  afterEach(async () => {
    await AvatarController.instance.stop();
    RuntimeReadinessCatalogStore.instance.clear();
  });

  it('keeps avatar runtime readiness aligned with shell lifecycle', async () => {
    await AvatarController.instance.init(createUnityAvatarHostConfig());

    await waitFor(() => Boolean(getAvatarRuntime()));
    expect(getAvatarRuntime()?.state).toBe('degraded');
    expect(getAvatarRuntime()?.reconciler?.actual).toBe('waiting-manual-launch');
    expect(getAvatarRuntime()?.reconciler?.resources.some((resource) => resource.resource_id === 'avatar.package-registry')).toBe(true);
    expect(getAvatarRuntime()?.reconciler?.resources.some((resource) => (
      resource.resource_id === 'avatar.sdk.catalog'
      || resource.resource_kind === 'unity_sdk'
    ))).toBe(true);

    const server = (AvatarController.instance as unknown as {
      _wss?: { address: () => string | { port: number } | null };
    })._wss;
    const address = server?.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    expect(port).toBeGreaterThan(0);

    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });

    await waitFor(() => getAvatarRuntime()?.reconciler?.actual === 'connected-waiting-ready-gates');

    socket.send(JSON.stringify({
      kind: 'host_hello',
      timestamp: Date.now(),
      host_hello: {
        host_kind: 'unity',
        host_id: 'test-shell',
        host_version: '0.0.1',
        model_id: 'selrena-youling',
        avatar_package_id: 'selrena-youling',
      },
    }));
    socket.send(JSON.stringify({
      kind: 'host_ready',
      timestamp: Date.now(),
      host_ready: {
        host_kind: 'unity',
        host_id: 'test-shell',
        host_version: '0.0.1',
        model_id: 'selrena-youling',
        avatar_package_id: 'selrena-youling',
        worker_window_state: 'isolated',
        composition_surface_state: 'attached',
        first_frame_presented: true,
        interaction_ready: true,
        summary: '首帧 ready',
      },
    }));

    await waitFor(() => getAvatarRuntime()?.state === 'ready');
    expect(getAvatarRuntime()?.reconciler?.actual).toBe('connected-first-frame-presented');

    socket.close();
    await waitFor(() => getAvatarRuntime()?.reconciler?.actual === 'waiting-manual-launch');
    expect(getAvatarRuntime()?.state).toBe('degraded');
  });
});
