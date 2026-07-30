#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dataRoot = path.resolve(process.env.GLIMMER_CRADLE_DATA_ROOT || path.join(repoRoot, 'data'));
const inboxRoot = path.join(dataRoot, 'state', 'kernel', 'dlq-replay-inbox');
const processedRoot = path.join(inboxRoot, 'processed');
const receiptPath = (operationId) => path.join(processedRoot, `${operationId}.receipt.json`);
const input = await readStdin(4 * 1024 * 1024);
const request = JSON.parse(input);
validateRequest(request);

const parsedPayload = JSON.parse(request.payload_json);
if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
  throw new Error('kernel_dlq_payload_not_event');
}
if (parsedPayload.event_type !== request.event_type) {
  throw new Error('kernel_dlq_event_type_mismatch');
}
const digest = createHash('sha256').update(request.payload_json, 'utf8').digest('hex');
if (digest !== request.payload_digest) throw new Error('kernel_dlq_payload_digest_mismatch');

await fs.mkdir(inboxRoot, { recursive: true, mode: 0o700 });
const queuePath = path.join(inboxRoot, `${request.operation_id}.json`);
const queued = {
  schema_version: 1,
  source: request.source,
  record_id: request.id,
  owner: request.owner,
  event_type: request.event_type,
  trace_id: request.trace_id,
  payload_json: request.payload_json,
  payload_digest: request.payload_digest,
  operation_id: request.operation_id,
  dispatcher_id: request.dispatcher_id,
  queued_at: new Date().toISOString(),
};
const serialized = `${JSON.stringify(queued)}\n`;
let receipt = await readJson(receiptPath(request.operation_id));
if (!receipt) {
  try {
    const handle = await fs.open(queuePath, 'wx', 0o600);
    try {
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = JSON.parse(await fs.readFile(queuePath, 'utf8'));
    assertBinding(existing, queued);
  }
  receipt = await waitForReceipt(
    receiptPath(request.operation_id),
    Number(process.env.GLIMMER_CRADLE_DLQ_REPLAY_TIMEOUT_MS || 30_000),
  );
}
assertBinding(receipt, {
  ...queued,
  status: 'success',
  receipt_id: `kernel_event_bus_${request.operation_id}`,
  delivery: 'kernel_event_bus_published',
});
process.stdout.write(`${JSON.stringify(receipt)}\n`);

function validateRequest(value) {
  if (!value || typeof value !== 'object'
    || value.source !== 'kernel'
    || value.owner !== 'kernel'
    || value.dispatcher_id !== 'kernel.event-bus.v1'
    || !Number.isInteger(value.id)
    || typeof value.trace_id !== 'string'
    || typeof value.event_type !== 'string'
    || typeof value.payload_json !== 'string'
    || !/^[0-9a-f]{64}$/.test(value.payload_digest)
    || !/^dlq_replay_[0-9a-f]{32}$/.test(value.operation_id)) {
    throw new Error('kernel_dlq_dispatch_request_invalid');
  }
}

function assertBinding(actual, expected) {
  for (const field of [
    'source',
    'record_id',
    'owner',
    'event_type',
    'trace_id',
    'payload_digest',
    'operation_id',
    'dispatcher_id',
  ]) {
    if (actual?.[field] !== expected[field]) throw new Error('kernel_dlq_operation_conflict');
  }
  if (expected.status && actual.status !== expected.status) {
    throw new Error('kernel_dlq_receipt_status_invalid');
  }
  if (expected.receipt_id && actual.receipt_id !== expected.receipt_id) {
    throw new Error('kernel_dlq_receipt_id_invalid');
  }
  if (expected.delivery && actual.delivery !== expected.delivery) {
    throw new Error('kernel_dlq_receipt_delivery_invalid');
  }
}

async function waitForReceipt(targetPath, timeoutMs) {
  const deadline = Date.now() + Math.min(Math.max(timeoutMs, 10), 120_000);
  while (Date.now() < deadline) {
    const receipt = await readJson(targetPath);
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('kernel_dlq_delivery_timeout');
}

async function readJson(targetPath) {
  try {
    return JSON.parse(await fs.readFile(targetPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function readStdin(maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    process.stdin.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('kernel_dlq_dispatch_request_too_large'));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    process.stdin.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.once('error', reject);
  });
}
