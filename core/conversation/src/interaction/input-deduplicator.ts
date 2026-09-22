import type { TurnSnapshot } from '../turns/turn-snapshot.js';
import type { InteractionInput } from './input.js';

type DeduplicationRecord = {
  readonly payloadDigest: string;
  state: 'pending' | 'completed';
  snapshot?: TurnSnapshot;
};

export type InputClaim =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'duplicate_pending' }
  | { readonly kind: 'duplicate_completed'; readonly snapshot: TurnSnapshot }
  | { readonly kind: 'conflict' };

/** 进程内 admission 去重；持久完成事实仍由 Conversation Turn owner 确认。 */
export class InputDeduplicator {
  private readonly records = new Map<string, DeduplicationRecord>();

  public claim(input: InteractionInput): InputClaim {
    const existing = this.records.get(input.deduplication_key);
    if (!existing) {
      this.records.set(input.deduplication_key, {
        payloadDigest: input.payload_digest,
        state: 'pending',
      });
      return { kind: 'accepted' };
    }
    if (existing.payloadDigest !== input.payload_digest) return { kind: 'conflict' };
    if (existing.state === 'completed' && existing.snapshot) {
      return { kind: 'duplicate_completed', snapshot: existing.snapshot };
    }
    return { kind: 'duplicate_pending' };
  }

  public complete(input: InteractionInput, snapshot: TurnSnapshot): void {
    const record = this.records.get(input.deduplication_key);
    if (!record || record.payloadDigest !== input.payload_digest) {
      throw new Error(`Interaction 去重记录丢失或冲突: ${input.deduplication_key}`);
    }
    record.state = 'completed';
    record.snapshot = snapshot;
  }

  public release(input: InteractionInput): void {
    const record = this.records.get(input.deduplication_key);
    if (record?.payloadDigest === input.payload_digest && record.state === 'pending') {
      this.records.delete(input.deduplication_key);
    }
  }
}

