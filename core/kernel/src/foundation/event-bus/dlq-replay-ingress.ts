import { createHash } from 'node:crypto';
import {
  link,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { getLogger } from '../logger/logger';
import { resolveStatePath } from '../utils/path-utils';
import { EventBus } from './event-bus';

const logger = getLogger('dlq-replay-ingress');
const POLL_INTERVAL_MS = 500;

interface ReplayEnvelope {
  readonly schema_version: 1;
  readonly source: 'kernel';
  readonly record_id: number;
  readonly owner: 'kernel';
  readonly event_type: string;
  readonly trace_id: string;
  readonly payload_json: string;
  readonly payload_digest: string;
  readonly operation_id: string;
  readonly dispatcher_id: 'kernel.event-bus.v1';
  readonly queued_at: string;
}

export class DlqReplayIngress {
  private timer: ReturnType<typeof setInterval> | null = null;
  private draining = false;

  public constructor(
    private readonly inboxRoot = resolveStatePath('kernel/dlq-replay-inbox'),
    private readonly publish: (event: Record<string, unknown>) => Promise<void> = (
      event,
    ) => EventBus.instance.publish(event as never),
  ) {}

  public async start(): Promise<void> {
    await mkdir(this.inboxRoot, { recursive: true });
    await this.drainOnce();
    this.timer = setInterval(() => {
      void this.drainOnce().catch((error) => logger.error('DLQ replay ingress 处理失败', {
        error: error instanceof Error ? error.message : String(error),
      }));
    }, POLL_INTERVAL_MS);
    this.timer.unref();
  }

  public async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.waitUntilIdle();
  }

  public async drainOnce(): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    try {
      const entries = (await readdir(this.inboxRoot).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      })).filter((name) => /^dlq_replay_[0-9a-f]{32}\.json$/.test(name)).sort();
      let delivered = 0;
      for (const entry of entries) {
        if (await this.deliver(path.join(this.inboxRoot, entry))) delivered += 1;
      }
      return delivered;
    } finally {
      this.draining = false;
    }
  }

  private async deliver(filePath: string): Promise<boolean> {
    const envelope = JSON.parse(await readFile(filePath, 'utf8')) as ReplayEnvelope;
    validateEnvelope(envelope);
    const processedRoot = path.join(this.inboxRoot, 'processed');
    const processedPath = path.join(processedRoot, path.basename(filePath));
    const receiptPath = path.join(processedRoot, `${envelope.operation_id}.receipt.json`);
    const existingReceipt = await readJson(receiptPath);
    if (existingReceipt) {
      validateReceipt(existingReceipt, envelope);
      await archiveEnvelope(filePath, processedPath, envelope);
      return true;
    }
    const event = JSON.parse(envelope.payload_json) as Record<string, unknown>;
    if (!event || Array.isArray(event) || event.event_type !== envelope.event_type) {
      throw new Error('kernel_dlq_replay_event_mismatch');
    }
    await this.publish({
      ...event,
      replay_context: {
        operation_id: envelope.operation_id,
        source_record_id: envelope.record_id,
        trace_id: envelope.trace_id,
        payload_digest: envelope.payload_digest,
        ack_path: receiptPath,
      },
    });
    const receipt = await readJson(receiptPath);
    if (!receipt) throw new Error('kernel_dlq_replay_ack_missing');
    validateReceipt(receipt, envelope);
    await archiveEnvelope(filePath, processedPath, envelope);
    logger.info('DLQ payload 已交付 Kernel EventBus', {
      trace_id: envelope.trace_id,
      event_type: envelope.event_type,
      operation_id: envelope.operation_id,
      record_id: envelope.record_id,
    });
    return true;
  }

  private async waitUntilIdle(): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (this.draining && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

async function archiveEnvelope(
  filePath: string,
  processedPath: string,
  envelope: ReplayEnvelope,
): Promise<void> {
  try {
    await link(filePath, processedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = JSON.parse(await readFile(processedPath, 'utf8')) as ReplayEnvelope;
    validateEnvelope(existing);
    if (existing.operation_id !== envelope.operation_id
      || existing.payload_digest !== envelope.payload_digest) {
      throw new Error('kernel_dlq_replay_archive_conflict');
    }
  }
  await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function validateReceipt(
  receipt: Record<string, unknown> | null,
  envelope: ReplayEnvelope,
): void {
  if (receipt?.status !== 'success'
    || receipt.receipt_id !== `kernel_event_bus_${envelope.operation_id}`
    || receipt.source !== envelope.source
    || receipt.record_id !== envelope.record_id
    || receipt.owner !== envelope.owner
    || receipt.event_type !== envelope.event_type
    || receipt.trace_id !== envelope.trace_id
    || receipt.payload_digest !== envelope.payload_digest
    || receipt.operation_id !== envelope.operation_id
    || receipt.dispatcher_id !== envelope.dispatcher_id
    || receipt.delivery !== 'kernel_event_bus_published') {
    throw new Error('kernel_dlq_replay_receipt_conflict');
  }
}

function validateEnvelope(value: ReplayEnvelope): void {
  const digest = createHash('sha256').update(value.payload_json || '', 'utf8').digest('hex');
  if (value.schema_version !== 1
    || value.source !== 'kernel'
    || value.owner !== 'kernel'
    || value.dispatcher_id !== 'kernel.event-bus.v1'
    || !Number.isInteger(value.record_id)
    || !/^dlq_replay_[0-9a-f]{32}$/.test(value.operation_id)
    || !/^[0-9a-f]{64}$/.test(value.payload_digest)
    || value.payload_digest !== digest) {
    throw new Error('kernel_dlq_replay_envelope_invalid');
  }
}
