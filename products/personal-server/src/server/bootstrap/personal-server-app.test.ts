import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PersonalServerApp } from './personal-server-app';

test('serves recent observability logs through the authenticated control surface http api', async (t) => {
  const fixture = createPersonalServerFixture();
  await withDataRoot(fixture.dataRoot, async () => {
    const app = new PersonalServerApp({
      host: '127.0.0.1',
      port: 0,
      token: 'server-secret',
      productManifestPath: fixture.productManifestPath,
      cwd: fixture.root,
    });
    await app.start();
    t.after(() => void app.stop());

    const response = await fetch(`${fixture.baseUrl(app)}/api/v1/logs/recent?module=config-owner`, {
      headers: { authorization: 'Bearer server-secret' },
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as { entries?: Array<{ module: string; trace_id: string }> };
    assert.deepEqual(payload.entries?.map((entry) => entry.module), ['config-owner', 'config-owner']);
    assert.deepEqual(payload.entries?.map((entry) => entry.trace_id), ['trace-2', 'trace-1']);
  });
});

test('streams appended observability entries through server-sent events', async (t) => {
  const fixture = createPersonalServerFixture();
  await withDataRoot(fixture.dataRoot, async () => {
    const app = new PersonalServerApp({
      host: '127.0.0.1',
      port: 0,
      token: 'server-secret',
      productManifestPath: fixture.productManifestPath,
      cwd: fixture.root,
    });
    await app.start();
    t.after(() => void app.stop());

    const controller = new AbortController();
    t.after(() => controller.abort());
    const response = await fetch(`${fixture.baseUrl(app)}/api/v1/logs/stream?level=warn`, {
      headers: { authorization: 'Bearer server-secret' },
      signal: controller.signal,
    });

    assert.equal(response.status, 200);
    assert.ok(response.body);

    await waitForTimeout(1200);

    appendFileSync(
      fixture.applicationLogPath,
      `${JSON.stringify({
        timestamp: '2026-07-18T18:10:03.000Z',
        level: 'warn',
        module: 'surface-gateway',
        owner: 'kernel',
        runtime_id: 'kernel',
        trace_id: 'trace-4',
        message: 'surface disconnected',
      })}\n`,
      'utf8',
    );

    const eventPayload = await readSseEvent(response.body!, 'log-entry', 7_000);
    const entry = JSON.parse(eventPayload) as { level: string; trace_id: string; module: string };
    assert.equal(entry.level, 'warn');
    assert.equal(entry.trace_id, 'trace-4');
    assert.equal(entry.module, 'surface-gateway');
  });
});

test('stops promptly even when a log stream client is still connected', async (t) => {
  const fixture = createPersonalServerFixture();
  await withDataRoot(fixture.dataRoot, async () => {
    const app = new PersonalServerApp({
      host: '127.0.0.1',
      port: 0,
      token: 'server-secret',
      productManifestPath: fixture.productManifestPath,
      cwd: fixture.root,
    });
    await app.start();
    t.after(() => void app.stop());

    const controller = new AbortController();
    t.after(() => controller.abort());
    const response = await fetch(`${fixture.baseUrl(app)}/api/v1/logs/stream`, {
      headers: { authorization: 'Bearer server-secret' },
      signal: controller.signal,
    });

    assert.equal(response.status, 200);

    await Promise.race([
      app.stop(),
      waitForTimeout(2_000).then(() => {
        throw new Error('personal server stop timed out with open SSE client');
      }),
    ]);
  });
});

test('manages access tokens through authenticated http endpoints', async (t) => {
  const fixture = createPersonalServerFixture();
  await withDataRoot(fixture.dataRoot, async () => {
    const app = new PersonalServerApp({
      host: '127.0.0.1',
      port: 0,
      token: 'server-secret',
      productManifestPath: fixture.productManifestPath,
      cwd: fixture.root,
    });
    await app.start();
    t.after(() => void app.stop());

    const create = await fetch(`${fixture.baseUrl(app)}/api/v1/security/access-tokens`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer server-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ operation: 'create', label: 'Ops laptop' }),
    });
    assert.equal(create.status, 200);
    const created = await create.json() as { issued_token?: string; snapshot?: { mode?: string; tokens?: Array<{ label: string }> } };
    assert.match(created.issued_token || '', /^gcps_/);
    assert.equal(created.snapshot?.mode, 'managed');
    assert.equal(created.snapshot?.tokens?.some((token) => token.label === 'Ops laptop'), true);

    const list = await fetch(`${fixture.baseUrl(app)}/api/v1/security/access-tokens`, {
      headers: { authorization: `Bearer ${created.issued_token}` },
    });
    assert.equal(list.status, 200);
    const snapshot = await list.json() as { tokens?: Array<{ label: string; token_id: string }> };
    assert.equal(snapshot.tokens?.some((token) => token.label === 'Ops laptop'), true);
  });
});

test('accepts local .gcex uploads into the controlled extension upload root', async (t) => {
  const fixture = createPersonalServerFixture();
  await withDataRoot(fixture.dataRoot, async () => {
    const app = new PersonalServerApp({
      host: '127.0.0.1',
      port: 0,
      token: 'server-secret',
      productManifestPath: fixture.productManifestPath,
      cwd: fixture.root,
    });
    await app.start();
    t.after(() => void app.stop());

    const response = await fetch(`${fixture.baseUrl(app)}/api/v1/extensions/local-package`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer server-secret',
        'content-type': 'application/octet-stream',
        'x-glimmer-file-name': 'community.local-test-1.0.0-any.gcex',
      },
      body: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    });

    assert.equal(response.status, 200);
    const payload = await response.json() as {
      upload_id: string;
      file_name: string;
      size: number;
      expires_at: string;
    };
    assert.match(payload.upload_id, /^upload_/);
    assert.equal(payload.file_name, 'community.local-test-1.0.0-any.gcex');
    assert.equal(payload.size, 4);
    assert.match(payload.expires_at, /^20/);
    const uploadRoot = path.join(fixture.dataRoot, 'state', 'personal-server', 'extension-uploads');
    const entries = readdirSync(uploadRoot);
    assert.equal(entries.length, 1);
    assert.match(entries[0], /^upload_/);
  });
});

function createPersonalServerFixture(): {
  root: string;
  dataRoot: string;
  configRoot: string;
  productManifestPath: string;
  applicationLogPath: string;
  baseUrl: (app: PersonalServerApp) => string;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'personal-server-app-'));
  const dataRoot = path.join(root, 'data');
  const configRoot = path.join(root, 'configs');
  const productManifestPath = path.join(root, 'product.json');
  const eventLogPath = path.join(dataRoot, 'observability', 'logs', 'events', 'kernel.jsonl');
  const auditLogPath = path.join(dataRoot, 'observability', 'logs', 'audit', 'kernel.jsonl');
  const applicationLogPath = path.join(dataRoot, 'observability', 'logs', 'application', 'kernel.jsonl');

  mkdirSync(path.dirname(eventLogPath), { recursive: true });
  mkdirSync(path.dirname(auditLogPath), { recursive: true });
  mkdirSync(path.dirname(applicationLogPath), { recursive: true });

  writeFileSync(productManifestPath, JSON.stringify({
    schema_version: 1,
    id: 'personal-server',
    display_name: 'Personal Server',
    features: {
      control_surface_gateway: true,
      local_device_actions: false,
      avatar: false,
      audio: { tts: true, asr: false },
      extensions: true,
    },
  }), 'utf8');

  writeFileSync(eventLogPath, `${JSON.stringify({
    timestamp: '2026-07-18T18:10:00.000Z',
    level: 'info',
    event_type: 'config.snapshot',
    event_action: 'read',
    owner: 'configuration',
    module: 'config-owner',
    runtime_id: 'kernel',
    trace_id: 'trace-1',
  })}\n`, 'utf8');

  writeFileSync(auditLogPath, `${JSON.stringify({
    timestamp: '2026-07-18T18:10:01.000Z',
    action: 'config.apply',
    target_kind: 'llm_configuration',
    owner: 'configuration',
    module: 'config-owner',
    runtime_id: 'kernel',
    trace_id: 'trace-2',
    outcome: 'failed',
    reason: 'conflict',
  })}\n`, 'utf8');

  writeFileSync(applicationLogPath, `${JSON.stringify({
    timestamp: '2026-07-18T18:10:02.000Z',
    level: 'info',
    module: 'kernel-runtime',
    owner: 'kernel',
    runtime_id: 'kernel',
    trace_id: 'trace-3',
    message: 'runtime ready',
  })}\n`, 'utf8');

  return {
    root,
    dataRoot,
    configRoot,
    productManifestPath,
    applicationLogPath,
    baseUrl: (app) => {
      const address = ((app as unknown) as { server: { address(): { port: number } | null } }).server.address();
      if (!address) throw new Error('personal server did not bind to a port');
      return `http://127.0.0.1:${address.port}`;
    },
  };
}

async function withDataRoot(dataRoot: string, callback: () => Promise<void>): Promise<void> {
  const previous = process.env.GLIMMER_CRADLE_DATA_ROOT;
  const previousConfigRoot = process.env.GLIMMER_CRADLE_CONFIG_ROOT;
  process.env.GLIMMER_CRADLE_DATA_ROOT = dataRoot;
  process.env.GLIMMER_CRADLE_CONFIG_ROOT = path.join(path.dirname(dataRoot), 'configs');
  try {
    await callback();
  } finally {
    if (previous === undefined) {
      delete process.env.GLIMMER_CRADLE_DATA_ROOT;
    } else {
      process.env.GLIMMER_CRADLE_DATA_ROOT = previous;
    }
    if (previousConfigRoot === undefined) {
      delete process.env.GLIMMER_CRADLE_CONFIG_ROOT;
    } else {
      process.env.GLIMMER_CRADLE_CONFIG_ROOT = previousConfigRoot;
    }
  }
}

async function readSseEvent(
  stream: ReadableStream<Uint8Array>,
  eventName: string,
  timeoutMs: number,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let buffer = '';

  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const chunk = await Promise.race([
        reader.read(),
        waitForTimeout(remaining).then(() => ({ done: true, value: undefined as Uint8Array | undefined })),
      ]);
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        const name = block.match(/^event:\s*(.+)$/m)?.[1]?.trim();
        const data = block.match(/^data:\s*(.+)$/m)?.[1] ?? '';
        if (name === eventName) return data;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  throw new Error(`did not receive SSE event ${eventName} within ${timeoutMs}ms`);
}

function waitForTimeout(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(1, timeoutMs)));
}
