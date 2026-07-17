import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeReadinessCatalog } from '@glimmer-cradle/protocol';
import { WebSocketServer } from 'ws';
import { deriveKernelReadinessStatus } from './kernel-readiness-monitor';
import { KernelReadinessMonitor } from './kernel-readiness-monitor';

function catalog(
  ingressState: 'starting' | 'ready' | 'failed',
  cognitionState: 'starting' | 'ready' | 'failed',
): RuntimeReadinessCatalog {
  return {
    updated_at: Date.now(),
    runtimes: [
      {
        runtime_id: 'kernel.ingress',
        owner: 'kernel',
        phase: 'ingress_gate',
        state: ingressState,
        blocking: true,
        summary: 'ingress',
      },
      {
        runtime_id: 'cognition',
        owner: 'cognition',
        phase: 'ipc_config_knowledge',
        state: cognitionState,
        blocking: true,
        summary: 'cognition',
      },
    ],
  };
}

test('requires the canonical ingress runtime and every blocking runtime to be ready', () => {
  assert.equal(deriveKernelReadinessStatus(null).ready, false);
  assert.equal(deriveKernelReadinessStatus(catalog('starting', 'ready')).ready, false);
  assert.equal(deriveKernelReadinessStatus(catalog('ready', 'starting')).ready, false);
  assert.equal(deriveKernelReadinessStatus(catalog('ready', 'ready')).ready, true);
});

test('projects blocking failures as failed readiness', () => {
  const status = deriveKernelReadinessStatus(catalog('starting', 'failed'));
  assert.equal(status.ready, false);
  assert.equal(status.status, 'failed');
  assert.deepEqual(status.blocking_runtimes.map((runtime) => runtime.runtime_id), [
    'kernel.ingress',
    'cognition',
  ]);
});

test('reconnects when the endpoint appears after product startup and observes canonical readiness', async (t) => {
  let endpoint: string | null = null;
  const monitor = new KernelReadinessMonitor(async () => endpoint, 20);
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => {
    monitor.stop();
    server.close();
  });

  monitor.start();
  assert.equal(monitor.getStatus().connection_state, 'disconnected');

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  endpoint = `ws://127.0.0.1:${address.port}`;
  server.once('connection', (socket) => {
    socket.send(JSON.stringify({
      kind: 'runtime_readiness',
      timestamp: Date.now(),
      runtime_readiness: catalog('ready', 'ready'),
    }));
  });

  await waitUntil(() => monitor.getStatus().ready, 2_000);
  const status = monitor.getStatus();
  assert.equal(status.connection_state, 'observing');
  assert.equal(status.status, 'ready');
  assert.ok(status.observed_at);
});

test('forwards the Kernel shutdown frame to the product lifecycle owner', async (t) => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  let shutdownRequests = 0;
  const monitor = new KernelReadinessMonitor(
    async () => `ws://127.0.0.1:${address.port}`,
    20,
    () => { shutdownRequests += 1; },
  );
  t.after(() => {
    monitor.stop();
    server.close();
  });
  server.once('connection', (socket) => {
    socket.send(JSON.stringify({ kind: 'shutdown', timestamp: Date.now() }));
  });

  monitor.start();
  await waitUntil(() => shutdownRequests === 1, 2_000);
  assert.equal(monitor.getStatus().ready, false);
});

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}
