import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DlqReplayIngress } from './dlq-replay-ingress';
import { EventBus } from './event-bus';

const roots: string[] = [];
const originalDataRoot = process.env.GLIMMER_CRADLE_DATA_ROOT;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
  if (originalDataRoot === undefined) delete process.env.GLIMMER_CRADLE_DATA_ROOT;
  else process.env.GLIMMER_CRADLE_DATA_ROOT = originalDataRoot;
});

describe('DlqReplayIngress', () => {
  it('把 owner dispatcher 的 durable envelope 交给真实 EventBus ingress contract', async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kernel-dlq-ingress-'));
    roots.push(dataRoot);
    process.env.GLIMMER_CRADLE_DATA_ROOT = dataRoot;
    const root = path.join(dataRoot, 'state', 'kernel', 'dlq-replay-inbox');
    const operationId = `dlq_replay_${'a'.repeat(32)}`;
    await writeEnvelope(root, operationId, 'Event.Test', 'event-1', 'trace-1', 7);
    const delivered: Array<Record<string, unknown>> = [];
    const handler = async (event: Record<string, unknown>) => {
      delivered.push(event);
    };
    EventBus.instance.subscribe('Event.Test', handler as never);
    const ingress = new DlqReplayIngress(root);

    try {
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
    } finally {
      EventBus.instance.unsubscribe('Event.Test', handler as never);
    }
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
    process.env.GLIMMER_CRADLE_DATA_ROOT = dataRoot;
    const handler = async (event: Record<string, unknown>) => {
      delivered.push(event);
    };
    EventBus.instance.subscribe('Event.Replay', handler as never);
    const ingress = new DlqReplayIngress(inboxRoot);
    const dispatcherPath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      'tools',
      'dlq-replay-dispatcher.mjs',
    );
    try {
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
    } finally {
      EventBus.instance.unsubscribe('Event.Replay', handler as never);
    }
  });

  it('no-handler、required failure 与 partial delivery 均不产生成功回执或归档', async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kernel-dlq-fail-closed-'));
    roots.push(dataRoot);
    process.env.GLIMMER_CRADLE_DATA_ROOT = dataRoot;
    const root = path.join(dataRoot, 'state', 'kernel', 'dlq-replay-inbox');
    const noHandlerId = `dlq_replay_${'d'.repeat(32)}`;
    await writeEnvelope(root, noHandlerId, 'Event.NoHandler', 'event-no-handler', 'trace-no-handler', 20);
    const ingress = new DlqReplayIngress(root);
    await expect(ingress.drainOnce()).rejects.toThrow('event_bus_no_handler:Event.NoHandler');
    expect(await fs.pathExists(path.join(root, `${noHandlerId}.json`))).toBe(true);
    await fs.remove(path.join(root, `${noHandlerId}.json`));

    const requiredFailureId = `dlq_replay_${'e'.repeat(32)}`;
    await writeEnvelope(root, requiredFailureId, 'Event.RequiredFailure', 'event-required-failure', 'trace-required', 21);
    const requiredFailure = async () => { throw new Error('required handler failed'); };
    EventBus.instance.subscribe('Event.RequiredFailure', requiredFailure as never);
    try {
      await expect(ingress.drainOnce()).rejects.toThrow('event_bus_handler_failed:1');
      expect(await fs.pathExists(path.join(root, `${requiredFailureId}.json`))).toBe(true);
      expect(await fs.pathExists(path.join(root, 'processed', `${requiredFailureId}.receipt.json`))).toBe(false);
    } finally {
      EventBus.instance.unsubscribe('Event.RequiredFailure', requiredFailure as never);
    }
    await fs.remove(path.join(root, `${requiredFailureId}.json`));

    const partialId = `dlq_replay_${'f'.repeat(32)}`;
    await writeEnvelope(root, partialId, 'Event.Partial', 'event-partial', 'trace-partial', 22);
    let completed = 0;
    const successful = async () => { completed += 1; };
    const failed = async () => { throw new Error('partial handler failed'); };
    EventBus.instance.subscribe('Event.Partial', successful as never);
    EventBus.instance.subscribe('Event.Partial', failed as never);
    try {
      await expect(ingress.drainOnce()).rejects.toThrow('event_bus_handler_failed:1');
      expect(completed).toBe(1);
      expect(await fs.pathExists(path.join(root, `${partialId}.json`))).toBe(true);
      expect(await fs.pathExists(path.join(root, 'processed', `${partialId}.receipt.json`))).toBe(false);
    } finally {
      EventBus.instance.unsubscribe('Event.Partial', successful as never);
      EventBus.instance.unsubscribe('Event.Partial', failed as never);
    }
  });

  it('receipt 持久化崩溃后保留证据，重试仅在 durable ack 后归档', async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kernel-dlq-retry-'));
    roots.push(dataRoot);
    process.env.GLIMMER_CRADLE_DATA_ROOT = dataRoot;
    const root = path.join(dataRoot, 'state', 'kernel', 'dlq-replay-inbox');
    const operationId = `dlq_replay_${'1'.repeat(32)}`;
    await writeEnvelope(root, operationId, 'Event.Retry', 'event-retry', 'trace-retry', 23);
    let attempts = 0;
    const handler = async () => { attempts += 1; };
    EventBus.instance.subscribe('Event.Retry', handler as never);
    const ingress = new DlqReplayIngress(root);
    try {
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(path.join(root, 'processed'), 'blocks durable receipt');
      await expect(ingress.drainOnce()).rejects.toThrow();
      expect(attempts).toBe(1);
      expect(await fs.pathExists(path.join(root, `${operationId}.json`))).toBe(true);

      await fs.remove(path.join(root, 'processed'));
      expect(await ingress.drainOnce()).toBe(1);
      expect(attempts).toBe(2);
      expect(await fs.pathExists(path.join(root, 'processed', `${operationId}.receipt.json`))).toBe(true);
      expect(await fs.pathExists(path.join(root, `${operationId}.json`))).toBe(false);

      await writeEnvelope(root, operationId, 'Event.Retry', 'event-retry', 'trace-retry', 23);
      expect(await ingress.drainOnce()).toBe(1);
      expect(attempts).toBe(2);
    } finally {
      EventBus.instance.unsubscribe('Event.Retry', handler as never);
    }
  });

  it('拒绝 forged receipt，保留 envelope 供 owner 调查', async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kernel-dlq-forged-'));
    roots.push(dataRoot);
    process.env.GLIMMER_CRADLE_DATA_ROOT = dataRoot;
    const root = path.join(dataRoot, 'state', 'kernel', 'dlq-replay-inbox');
    const operationId = `dlq_replay_${'2'.repeat(32)}`;
    await writeEnvelope(root, operationId, 'Event.Forged', 'event-forged', 'trace-forged', 24);
    await fs.mkdir(path.join(root, 'processed'), { recursive: true });
    await fs.writeJson(path.join(root, 'processed', `${operationId}.receipt.json`), {
      status: 'success',
      receipt_id: `kernel_event_bus_${operationId}`,
      source: 'kernel',
      record_id: 24,
      owner: 'kernel',
      event_type: 'Event.Forged',
      trace_id: 'forged-trace',
      payload_digest: '0'.repeat(64),
      operation_id: operationId,
      dispatcher_id: 'kernel.event-bus.v1',
      delivery: 'kernel_event_bus_published',
    });
    const ingress = new DlqReplayIngress(root);
    let effects = 0;
    const handler = async () => { effects += 1; };
    EventBus.instance.subscribe('Event.Forged', handler as never);
    try {
      await expect(ingress.drainOnce()).rejects.toThrow('event_bus_replay_ack_conflict');
      expect(effects).toBe(1);
      expect(await fs.pathExists(path.join(root, `${operationId}.json`))).toBe(true);
    } finally {
      EventBus.instance.unsubscribe('Event.Forged', handler as never);
    }
  });

  it('按 stable handler_id 记录逐 handler ledger，partial 重试跳过已提交效果并拒绝 inventory 漂移', async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kernel-dlq-handler-ledger-'));
    roots.push(dataRoot);
    process.env.GLIMMER_CRADLE_DATA_ROOT = dataRoot;
    const root = path.join(dataRoot, 'state', 'kernel', 'dlq-replay-inbox');
    const operationId = `dlq_replay_${'3'.repeat(32)}`;
    await writeEnvelope(root, operationId, 'Event.HandlerLedger', 'event-handler-ledger', 'trace-handler-ledger', 25);
    let first = 0;
    let second = 0;
    let fail = true;
    const firstHandler = async () => { first += 1; };
    const secondHandler = async () => { second += 1; if (fail) throw new Error('transient'); };
    EventBus.instance.subscribe('Event.HandlerLedger', firstHandler as never, { handler_id: 'handler.first', owner: 'owner.first' });
    EventBus.instance.subscribe('Event.HandlerLedger', secondHandler as never, { handler_id: 'handler.second', owner: 'owner.second' });
    const ingress = new DlqReplayIngress(root);
    try {
      await expect(ingress.drainOnce()).rejects.toThrow('event_bus_handler_failed:1');
      expect(first).toBe(1);
      expect(second).toBe(1);
      expect(await fs.pathExists(path.join(root, 'processed', 'effects', operationId, 'handler.first.json'))).toBe(true);
      expect((await fs.readJson(path.join(root, 'processed', 'effects', `${operationId}.inventory.json`))).handlers).toHaveLength(2);
      fail = false;
      expect(await ingress.drainOnce()).toBe(1);
      expect(first).toBe(1);
      expect(second).toBe(2);
      expect((await fs.readJson(path.join(root, 'processed', 'effects', `${operationId}.json`))).handler_ids).toEqual(['handler.first', 'handler.second']);

      const forged = `dlq_replay_${'4'.repeat(32)}`;
      await writeEnvelope(root, forged, 'Event.HandlerLedger', 'event-forged-ledger', 'trace-forged-ledger', 26);
      await fs.mkdir(path.join(root, 'processed', 'effects', forged), { recursive: true });
      await fs.writeJson(path.join(root, 'processed', 'effects', forged, 'handler.first.json'), {
        status: 'committed', owner: 'forged', handler_id: 'handler.first', event_type: 'Event.HandlerLedger', record_id: 26,
        trace_id: 'trace-forged-ledger', payload_digest: '0'.repeat(64), operation_id: forged,
      });
      await expect(ingress.drainOnce()).rejects.toThrow('event_bus_replay_handler_effect_conflict');
      expect(await fs.pathExists(path.join(root, `${forged}.json`))).toBe(true);
    } finally {
      EventBus.instance.unsubscribe('Event.HandlerLedger', firstHandler as never);
      EventBus.instance.unsubscribe('Event.HandlerLedger', secondHandler as never);
    }
  });
});

async function writeEnvelope(
  inboxRoot: string,
  operationId: string,
  eventType: string,
  eventId: string,
  traceId: string,
  recordId: number,
): Promise<void> {
  const payloadJson = JSON.stringify({
    event_type: eventType,
    event_id: eventId,
    trace_context: { trace_id: traceId },
  });
  await fs.mkdir(inboxRoot, { recursive: true });
  await fs.writeJson(path.join(inboxRoot, `${operationId}.json`), {
    schema_version: 1,
    source: 'kernel',
    record_id: recordId,
    owner: 'kernel',
    event_type: eventType,
    trace_id: traceId,
    payload_json: payloadJson,
    payload_digest: createHash('sha256').update(payloadJson).digest('hex'),
    operation_id: operationId,
    dispatcher_id: 'kernel.event-bus.v1',
    queued_at: new Date().toISOString(),
  });
}

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
