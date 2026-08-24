import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createDisposableRegistry } from './application/extension-module';
import {
  EXTENSION_HOST_PROCESS_CHANNELS as HOST_CHANNELS,
  EXTENSION_KERNEL_METHODS as HOST_KERNEL_METHODS,
} from './process-protocol';
import {
  EXTENSION_HOST_PROCESS_CHANNELS as SDK_CHANNELS,
  EXTENSION_KERNEL_METHODS as SDK_KERNEL_METHODS,
} from '@glimmer-cradle/extension-sdk/host/process-protocol';

const repoRoot = path.resolve(__dirname, '../../..');
const hostEntry = path.join(repoRoot, 'hosts', 'extension-host', 'src', 'main.ts');

describe('extension-host disposable registry', () => {
  it('disposes registrations in reverse order and clears the registry', async () => {
    const disposed: string[] = [];
    const registry = createDisposableRegistry();
    registry.add({ dispose: () => { disposed.push('first'); } });
    registry.add({ dispose: async () => { disposed.push('second'); } });

    await registry.disposeAll();

    expect(disposed).toEqual(['second', 'first']);
    expect(registry.size()).toBe(0);
  });
});

describe('extension-host process lifecycle', () => {
  const children: ChildProcess[] = [];
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (!child.killed) child.kill();
    }
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('re-exports the SDK-owned Node IPC transport symbols', () => {
    expect(HOST_CHANNELS).toBe(SDK_CHANNELS);
    expect(HOST_KERNEL_METHODS).toBe(SDK_KERNEL_METHODS);
  });

  it('exits after parent IPC disconnect even when registration.dispose cannot be sent', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'glimmer-extension-host-disconnect-'));
    temporaryRoots.push(root);
    const entry = path.join(root, 'extension.js');
    await writeFile(entry, [
      'module.exports = {',
      '  onActivate(ctx) {',
      "    ctx.ports.commands.registerCommand(`${ctx.extensionId}.leaky`, () => 'ok');",
      '  }',
      '};',
      '',
    ].join('\n'), 'utf8');

    const child = forkHost(root, 'demo.disconnect');
    children.push(child);
    child.on('message', (message) => {
      const record = asRecord(message);
      if (record.channel !== 'extension-kernel-request') return;
      if (record.method === 'commands.register') {
        respond(child, readString(record.request_id), true, { registration_id: 'command:leaky' });
      }
    });

    await waitForReady(child);
    child.send({
      channel: 'extension-host-process-request',
      request_id: 'activate',
      method: 'activate',
      payload: { extension_id: 'demo.disconnect', entry_path: entry, config: {} },
    });
    await waitForResponse(child, 'activate');

    child.disconnect();

    const exit = await waitForExit(child, 2000);
    expect(exit.code).toBe(0);
  });

  it('finishes deactivate when registration.dispose is sent but never answered', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'glimmer-extension-host-hung-dispose-'));
    temporaryRoots.push(root);
    const entry = path.join(root, 'extension.js');
    await writeFile(entry, [
      'module.exports = {',
      '  onActivate(ctx) {',
      "    ctx.ports.commands.registerCommand(`${ctx.extensionId}.hung`, () => 'ok');",
      '  }',
      '};',
      '',
    ].join('\n'), 'utf8');

    const child = forkHost(root, 'demo.hung');
    children.push(child);
    child.on('message', (message) => {
      const record = asRecord(message);
      if (record.channel !== 'extension-kernel-request') return;
      if (record.method === 'commands.register') {
        respond(child, readString(record.request_id), true, { registration_id: 'command:hung' });
      }
    });

    await waitForReady(child);
    child.send({
      channel: 'extension-host-process-request',
      request_id: 'activate',
      method: 'activate',
      payload: { extension_id: 'demo.hung', entry_path: entry, config: {} },
    });
    await waitForResponse(child, 'activate');
    child.send({
      channel: 'extension-host-process-request',
      request_id: 'deactivate',
      method: 'deactivate',
    });

    const response = await waitForResponse(child, 'deactivate', 2000);
    expect(response.ok).toBe(true);

    child.disconnect();
    const exit = await waitForExit(child, 2000);
    expect(exit.code).toBe(0);
  });
});

function forkHost(cwd: string, extensionId: string): ChildProcess {
  return fork(hostEntry, [], {
    cwd,
    env: {
      ...process.env,
      GLIMMER_CRADLE_EXTENSION_ID: extensionId,
      GLIMMER_CRADLE_EXTENSION_HOST_IPC_REQUEST_TIMEOUT_MS: '50',
      GLIMMER_CRADLE_EXTENSION_HOST_DEACTIVATE_TIMEOUT_MS: '250',
    },
    execArgv: ['--import', pathToFileURL(require.resolve('tsx')).href],
    serialization: 'advanced',
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
}

function respond(child: ChildProcess, requestId: string, ok: boolean, result?: unknown): void {
  child.send({
    channel: 'extension-host-process-response',
    request_id: requestId,
    ok,
    result,
  });
}

function waitForReady(child: ChildProcess, timeoutMs = 1000): Promise<void> {
  return waitForMessage(child, (message) => asRecord(message).channel === 'extension-host-process-ready', timeoutMs).then(() => undefined);
}

function waitForResponse(child: ChildProcess, requestId: string, timeoutMs = 1000): Promise<Record<string, any>> {
  return waitForMessage(child, (message) => {
    const record = asRecord(message);
    return record.channel === 'extension-host-process-response' && record.request_id === requestId;
  }, timeoutMs);
}

function waitForMessage(
  child: ChildProcess,
  predicate: (message: unknown) => boolean,
  timeoutMs: number,
): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('message', onMessage);
      reject(new Error('timed out waiting for Extension Host message'));
    }, timeoutMs);
    const onMessage = (message: unknown) => {
      if (!predicate(message)) return;
      clearTimeout(timer);
      child.off('message', onMessage);
      resolve(asRecord(message));
    };
    child.on('message', onMessage);
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error('timed out waiting for Extension Host exit'));
    }, timeoutMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve({ code, signal });
    };
    child.on('exit', onExit);
  });
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
