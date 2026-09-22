export type DeliveryStatus =
  | 'generated'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'playing'
  | 'completed'
  | 'interrupted'
  | 'failed'
  | 'unknown';

export interface OutputGeneration {
  readonly output_id: string;
  readonly turn_id: string;
  readonly destination_id: string;
  readonly authority_epoch: string;
  readonly generation: number;
  readonly content_digest: string;
  readonly status: DeliveryStatus;
  readonly heard_through_ms: number;
  readonly duration_ms: number | null;
  readonly terminal_reason: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export const TERMINAL_DELIVERY_STATUSES: ReadonlySet<DeliveryStatus> = new Set([
  'completed', 'interrupted', 'failed',
]);

