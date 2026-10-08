import type { BindingClock } from '../binding/binding-resolver.js';
import type {
  CreateOutputRequest,
  DeliveryStorePort,
  DeliveryTransition,
} from './delivery-store-port.js';
import {
  TERMINAL_DELIVERY_STATUSES,
  type DeliveryStatus,
  type OutputGeneration,
} from './output-generation.js';
import { validatePlayoutProgress } from './playout.js';
import { DeliveryReceiptConflictError, deliveryReceiptIdentity, validateDeliveryReceipt,
  type DeliveryReceiptEnvelope, type DeliveryReceiptFact, type ReceiptDecision } from './receipt.js';

const SYSTEM_DELIVERY_CLOCK: BindingClock = { nowIso: () => new Date().toISOString() };

const TRANSITIONS: Record<DeliveryStatus, ReadonlySet<DeliveryStatus>> = {
  generated: new Set(['queued', 'interrupted', 'failed']),
  queued: new Set(['sent', 'unknown', 'interrupted', 'failed']),
  sent: new Set(['delivered', 'playing', 'unknown', 'interrupted', 'failed']),
  delivered: new Set(['delivered', 'playing', 'completed', 'unknown', 'interrupted', 'failed']),
  playing: new Set(['playing', 'completed', 'unknown', 'interrupted', 'failed']),
  unknown: new Set(['delivered', 'playing', 'completed', 'failed', 'interrupted']),
  completed: new Set(),
  interrupted: new Set(),
  failed: new Set(),
};

export class DeliveryController {
  public constructor(
    private readonly store: DeliveryStorePort,
    private readonly authorityEpoch: string,
    private readonly clock: BindingClock = SYSTEM_DELIVERY_CLOCK,
  ) {
    if (!authorityEpoch.trim()) throw new TypeError('Delivery authority_epoch 不得为空');
    this.store.activateEpoch(authorityEpoch, this.clock.nowIso());
  }

  public begin(request: Omit<CreateOutputRequest, 'authority_epoch' | 'created_at'>): OutputGeneration {
    for (const [name, value] of Object.entries(request)) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError(`Delivery ${name} 不得为空`);
      }
    }
    return this.store.allocate({
      ...request,
      authority_epoch: this.authorityEpoch,
      created_at: this.clock.nowIso(),
    });
  }

  public queue(outputId: string): OutputGeneration {
    return this.move(outputId, 'queued');
  }

  public sent(outputId: string): OutputGeneration {
    return this.move(outputId, 'sent');
  }

  public unknown(outputId: string, reason: string): OutputGeneration {
    if (!this.store.isCurrentEpoch(this.authorityEpoch)) throw new Error('Delivery authority epoch 已失效');
    const current = this.store.load(outputId);
    if (!current) throw new Error(`Delivery output 不存在: ${outputId}`);
    if (current.authority_epoch !== this.authorityEpoch) {
      throw new Error(`Delivery authority epoch 已失效: ${outputId}`);
    }
    if (current.status === 'unknown') return current;
    if (!TRANSITIONS[current.status].has('unknown')) {
      throw new Error(`Delivery 非法转换: ${current.status} -> unknown`);
    }
    const updated = this.store.transition(
      outputId,
      current.authority_epoch,
      current.generation,
      new Set([current.status]),
      {
        status: 'unknown',
        updated_at: this.clock.nowIso(),
        terminal_reason: reason.trim() || 'delivery_unknown',
      },
    );
    if (!updated) throw new Error(`Delivery generation 已失效: ${outputId}`);
    return updated;
  }

  public interrupt(destinationId: string, reason: string): number {
    if (!reason.trim()) throw new TypeError('Delivery interrupt reason 不得为空');
    return this.store.interrupt(
      destinationId, this.authorityEpoch, this.clock.nowIso(), reason.trim(),
    );
  }

  public applyReceipt(envelope: DeliveryReceiptEnvelope): ReceiptDecision {
    validateDeliveryReceipt(envelope);
    if (envelope.authority_epoch !== this.authorityEpoch || !this.store.isCurrentEpoch(this.authorityEpoch)) {
      return { accepted: false, reason: 'stale_generation' };
    }
    try {
      const fact = this.store.receipt(envelope.receipt.receipt_id);
      if (fact) return deliveryReceiptIdentity(fact.envelope) === deliveryReceiptIdentity(envelope)
        ? { accepted: true, reason: 'duplicate' } : { accepted: false, reason: 'receipt_conflict' };
    } catch (error) {
      if (error instanceof DeliveryReceiptConflictError) return { accepted: false, reason: 'receipt_conflict' };
      throw error;
    }
    const current = this.store.load(envelope.output_id);
    if (!current) return { accepted: false, reason: 'unknown_output' };
    if (
      envelope.authority_epoch !== this.authorityEpoch
      || current.authority_epoch !== envelope.authority_epoch
      || current.destination_id !== envelope.destination_id
      || current.generation !== envelope.generation
    ) {
      return { accepted: false, reason: 'stale_generation' };
    }
    if (TERMINAL_DELIVERY_STATUSES.has(current.status)) {
      return { accepted: false, reason: 'stale_generation' };
    }

    const receipt = envelope.receipt;
    let transition: DeliveryTransition;
    if (receipt.kind === 'delivered') {
      transition = { status: 'delivered', updated_at: envelope.received_at, receipt: envelope };
    } else if (receipt.kind === 'playback_started') {
      transition = { status: 'playing', updated_at: envelope.received_at, receipt: envelope };
    } else if (receipt.kind === 'playback_progress' || receipt.kind === 'playback_completed') {
      validatePlayoutProgress(current.heard_through_ms, {
        ...receipt, duration_ms: receipt.duration_ms ?? current.duration_ms ?? undefined,
      });
      transition = {
        status: receipt.kind === 'playback_completed' ? 'completed' : 'playing',
        updated_at: envelope.received_at,
        heard_through_ms: receipt.heard_through_ms,
        duration_ms: receipt.duration_ms ?? current.duration_ms,
        receipt: envelope,
      };
    } else {
      transition = {
        status: receipt.kind,
        updated_at: envelope.received_at,
        terminal_reason: receipt.reason.trim() || receipt.kind,
        receipt: envelope,
      };
    }
    if (!TRANSITIONS[current.status].has(transition.status)) {
      throw new Error(`Delivery 非法回执转换: ${current.status} -> ${transition.status}`);
    }
    const updated = this.store.transition(
      current.output_id,
      current.authority_epoch,
      current.generation,
      new Set([current.status]),
      transition,
    );
    return updated
      ? { accepted: true }
      : { accepted: false, reason: 'stale_generation' };
  }

  public recover(): OutputGeneration[] {
    return this.store.recover(this.authorityEpoch);
  }

  /** 历史接纳事实可由新主对账；查询不接纳迟到回执、不证明当前发送权限。 */
  public receipt(receiptId: string): DeliveryReceiptFact | null {
    if (!this.store.isCurrentEpoch(this.authorityEpoch)) throw new Error('Delivery authority epoch 已失效');
    return this.store.receipt(receiptId);
  }

  public confirmedReceipt(outputId: string): DeliveryReceiptFact | null {
    if (!this.store.isCurrentEpoch(this.authorityEpoch)) throw new Error('Delivery authority epoch 已失效');
    return this.store.confirmedReceipt(outputId);
  }

  public current(outputId: string): OutputGeneration | null {
    const output = this.store.load(outputId);
    return this.store.isCurrentEpoch(this.authorityEpoch) && output?.authority_epoch === this.authorityEpoch ? output : null;
  }

  private move(outputId: string, status: DeliveryStatus): OutputGeneration {
    if (!this.store.isCurrentEpoch(this.authorityEpoch)) throw new Error('Delivery authority epoch 已失效');
    const current = this.store.load(outputId);
    if (!current) throw new Error(`Delivery output 不存在: ${outputId}`);
    if (current.authority_epoch !== this.authorityEpoch) {
      throw new Error(`Delivery authority epoch 已失效: ${outputId}`);
    }
    if (!TRANSITIONS[current.status].has(status)) {
      if (current.status === status) return current;
      throw new Error(`Delivery 非法转换: ${current.status} -> ${status}`);
    }
    const updated = this.store.transition(
      outputId,
      current.authority_epoch,
      current.generation,
      new Set([current.status]),
      { status, updated_at: this.clock.nowIso() },
    );
    if (!updated) throw new Error(`Delivery generation 已失效: ${outputId}`);
    return updated;
  }
}
