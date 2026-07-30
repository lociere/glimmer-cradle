import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DlqReplayIngress } from './dlq-replay-ingress';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
});

describe('DlqReplayIngress', () => {
  it('把 owner dispatcher 的 durable envelope 交给真实 EventBus ingress contract', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kernel-dlq-ingress-'));
    roots.push(root);
    const payloadJson = JSON.stringify({
      event_type: 'Event.Test',
      event_id: 'event-1',
      trace_context: { trace_id: 'trace-1' },
    });
    const operationId = `dlq_replay_${'a'.repeat(32)}`;
    await fs.writeJson(path.join(root, `${operationId}.json`), {
      schema_version: 1,
      source: 'kernel',
      record_id: 7,
      owner: 'kernel',
      event_type: 'Event.Test',
      trace_id: 'trace-1',
      payload_json: payloadJson,
      payload_digest: createHash('sha256').update(payloadJson).digest('hex'),
      operation_id: operationId,
      dispatcher_id: 'kernel.event-bus.v1',
      queued_at: new Date().toISOString(),
    });
    const delivered: Array<Record<string, unknown>> = [];
    const ingress = new DlqReplayIngress(root, async (event) => {
      delivered.push(event);
    });

    expect(await ingress.drainOnce()).toBe(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      event_type: 'Event.Test',
      event_id: 'event-1',
      replay_context: {
        operation_id: operationId,
        source_record_id: 7,
      },
    });
    expect(await fs.pathExists(path.join(root, 'processed', `${operationId}.json`))).toBe(true);
    const receipt = await fs.readJson(
      path.join(root, 'processed', `${operationId}.receipt.json`),
    );
    expect(receipt).toMatchObject({
      status: 'success',
      delivery: 'kernel_event_bus_published',
      source: 'kernel',
      record_id: 7,
      trace_id: 'trace-1',
      operation_id: operationId,
    });
  });

  it('拒绝 digest 漂移且不移动证据', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kernel-dlq-invalid-'));
    roots.push(root);
    const operationId = `dlq_replay_${'b'.repeat(32)}`;
    const target = path.join(root, `${operationId}.json`);
    await fs.writeJson(target, {
      schema_version: 1,
      source: 'kernel',
      record_id: 8,
      owner: 'kernel',
      event_type: 'Event.Test',
      trace_id: 'trace-2',
      payload_json: '{"event_type":"Event.Test"}',
      payload_digest: '0'.repeat(64),
      operation_id: operationId,
      dispatcher_id: 'kernel.event-bus.v1',
      queued_at: new Date().toISOString(),
    });
    const ingress = new DlqReplayIngress(root, async () => undefined);

    await expect(ingress.drainOnce()).rejects.toThrow('kernel_dlq_replay_envelope_invalid');
    expect(await fs.pathExists(target)).toBe(true);
  });

  it('真实 owner dispatcher 等待 EventBus 下游效果后才返回绑定 receipt', async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kernel-dlq-e2e-'));
    roots.push(dataRoot);
    const inboxRoot = path.join(dataRoot, 'state', 'kernel', 'dlq-replay-inbox');
    const payloadJson = JSON.stringify({
      event_type: 'Event.Replay',
      event_id: 'event-replay',
      trace_context: { trace_id: 'trace-e2e' },
    });
    const operationId = `dlq_replay_${'c'.repeat(32)}`;
    const payloadDigest = createHash('sha256').update(payloadJson).digest('hex');
    const delivered: Array<Record<string, unknown>> = [];
    const ingress = new DlqReplayIngress(inboxRoot, async (event) => {
      delivered.push(event);
    });
    const dispatcherPath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      'tools',
      'dlq-replay-dispatcher.mjs',
    );
    const resultPromise = runDispatcher(dispatcherPath, {
      source: 'kernel',
      id: 19,
      owner: 'kernel',
      event_type: 'Event.Replay',
      trace_id: 'trace-e2e',
      payload_json: payloadJson,
      payload_digest: payloadDigest,
      operation_id: operationId,
      dispatcher_id: 'kernel.event-bus.v1',
    }, dataRoot);
    for (let attempt = 0; attempt < 100 && delivered.length === 0; attempt += 1) {
      await ingress.drainOnce();
      if (delivered.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const receipt = await resultPromise;
    expect(delivered).toHaveLength(1);
    expect(receipt).toMatchObject({
      status: 'success',
      delivery: 'kernel_event_bus_published',
      source: 'kernel',
      record_id: 19,
      event_type: 'Event.Replay',
      trace_id: 'trace-e2e',
      payload_digest: payloadDigest,
      operation_id: operationId,
      dispatcher_id: 'kernel.event-bus.v1',
    });
  });
});

function runDispatcher(
  dispatcherPath: string,
  payload: Record<string, unknown>,
  dataRoot: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [dispatcherPath], {
      env: {
        ...process.env,
        GLIMMER_CRADLE_DATA_ROOT: dataRoot,
        GLIMMER_CRADLE_DLQ_REPLAY_TIMEOUT_MS: '2000',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`dispatcher_exit_${code}:${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout) as Record<string, unknown>);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
