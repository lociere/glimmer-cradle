import type { DeliveryStatus, OutputGeneration } from './output-generation.js';
import type { DeliveryReceiptEnvelope, DeliveryReceiptFact } from './receipt.js';

export interface CreateOutputRequest {
  readonly output_id: string;
  readonly turn_id: string;
  readonly destination_id: string;
  readonly authority_epoch: string;
  readonly content_digest: string;
  readonly created_at: string;
}

export interface DeliveryTransition {
  readonly status: DeliveryStatus;
  readonly updated_at: string;
  readonly heard_through_ms?: number;
  readonly duration_ms?: number | null;
  readonly terminal_reason?: string | null;
  readonly receipt?: DeliveryReceiptEnvelope;
}

export interface DeliveryStorePort {
  activateEpoch(authorityEpoch: string, activatedAt: string): number;
  isCurrentEpoch(authorityEpoch: string): boolean;
  allocate(request: CreateOutputRequest): OutputGeneration;
  load(outputId: string): OutputGeneration | null;
  transition(
    outputId: string,
    authorityEpoch: string,
    generation: number,
    allowedStatuses: ReadonlySet<DeliveryStatus>,
    transition: DeliveryTransition,
  ): OutputGeneration | null;
  interrupt(
    destinationId: string,
    authorityEpoch: string,
    interruptedAt: string,
    reason: string,
  ): number;
  recover(authorityEpoch: string): OutputGeneration[];
  receipt(receiptId: string): DeliveryReceiptFact | null;
  confirmedReceipt(outputId: string): DeliveryReceiptFact | null;
  close(): void;
}
