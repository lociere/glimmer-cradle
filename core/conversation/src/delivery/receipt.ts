import type { PlayoutProgress } from './playout.js';

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

export interface ReceiptDecision {
  readonly accepted: boolean;
  readonly reason?: 'stale_generation' | 'unknown_output' | 'duplicate' | 'receipt_conflict';
}
