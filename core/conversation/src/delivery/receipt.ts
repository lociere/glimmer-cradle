import type { PlayoutProgress } from './playout.js';
import { validatePlayoutProgress } from './playout.js';

export type DeliveryReceipt =
  | { readonly kind: 'delivered'; readonly receipt_id: string }
  | { readonly kind: 'playback_started'; readonly receipt_id: string }
  | ({ readonly kind: 'playback_progress'; readonly receipt_id: string } & PlayoutProgress)
  | ({ readonly kind: 'playback_completed'; readonly receipt_id: string } & PlayoutProgress)
  | { readonly kind: 'failed'; readonly receipt_id: string; readonly reason: string }
  | { readonly kind: 'unknown'; readonly receipt_id: string; readonly reason: string };

export interface DeliveryReceiptEnvelope {
  readonly output_id: string;
  readonly destination_id: string;
  readonly authority_epoch: string;
  readonly generation: number;
  readonly received_at: string;
  readonly receipt: DeliveryReceipt;
}

export interface DeliveryReceiptFact {
  readonly envelope: DeliveryReceiptEnvelope;
  readonly turn_id: string;
  readonly content_digest: string;
}

export class DeliveryReceiptConflictError extends Error {}

/** 规范化只忽略传输到达时间；重投可更晚到达，但不能改变回执语义或原绑定。 */
export function deliveryReceiptIdentity(envelope: DeliveryReceiptEnvelope): string {
  const receipt = envelope.receipt;
  return JSON.stringify([envelope.output_id, envelope.destination_id, envelope.authority_epoch, envelope.generation,
    receipt.receipt_id, receipt.kind,
    'heard_through_ms' in receipt ? receipt.heard_through_ms : null,
    'duration_ms' in receipt ? receipt.duration_ms ?? null : null,
    'reason' in receipt ? receipt.reason : null]);
}

export function validateDeliveryReceipt(envelope: DeliveryReceiptEnvelope): void {
  if (!envelope || typeof envelope !== 'object' || !envelope.receipt || typeof envelope.receipt !== 'object') {
    throw new TypeError('Delivery receipt 信封缺失');
  }
  const receipt = envelope.receipt;
  const envelopeKeys = ['output_id', 'destination_id', 'authority_epoch', 'generation', 'received_at', 'receipt'];
  const keys = receipt.kind === 'playback_progress' || receipt.kind === 'playback_completed'
    ? ['kind', 'receipt_id', 'heard_through_ms', 'duration_ms'] : receipt.kind === 'failed' || receipt.kind === 'unknown'
      ? ['kind', 'receipt_id', 'reason'] : ['kind', 'receipt_id'];
  if (Object.keys(envelope).some(key => !envelopeKeys.includes(key)) || Object.keys(receipt).some(key => !keys.includes(key))
    || !['delivered', 'playback_started', 'playback_progress', 'playback_completed', 'failed', 'unknown'].includes(receipt.kind)) {
    throw new TypeError('Delivery receipt 字段/kind 无效');
  }
  for (const [name, value] of [['output_id', envelope.output_id], ['destination_id', envelope.destination_id],
    ['authority_epoch', envelope.authority_epoch], ['receipt_id', receipt.receipt_id], ['received_at', envelope.received_at]] as const) {
    if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value).length > 4096) {
      throw new TypeError(`Delivery receipt ${name} 无效或超出预算`);
    }
  }
  if (!Number.isFinite(Date.parse(envelope.received_at))) throw new TypeError('Delivery receipt received_at 必须是有效时间');
  if (!Number.isSafeInteger(envelope.generation) || envelope.generation <= 0) throw new TypeError('Delivery receipt generation 必须是正安全整数');
  if (receipt.kind === 'playback_progress' || receipt.kind === 'playback_completed') validatePlayoutProgress(0, receipt);
  if ((receipt.kind === 'failed' || receipt.kind === 'unknown')
    && (typeof receipt.reason !== 'string' || !receipt.reason.trim() || new TextEncoder().encode(receipt.reason).length > 4096)) {
    throw new TypeError('Delivery receipt reason 无效或超出预算');
  }
  if (new TextEncoder().encode(JSON.stringify(envelope)).length > 65_536) throw new TypeError('Delivery receipt 信封超过 64 KiB');
}

export interface ReceiptDecision {
  readonly accepted: boolean;
  readonly reason?: 'stale_generation' | 'unknown_output' | 'duplicate' | 'receipt_conflict';
}
