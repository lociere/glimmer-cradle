import type { TurnProcessorPort } from '../turns/turn-processor-port.js';
import type { TurnSnapshot } from '../turns/turn-snapshot.js';
import { InputDeduplicator } from './input-deduplicator.js';
import { interactionRouteKey, type InteractionInput } from './input.js';
import { InterruptionCoordinator } from './interruption.js';

export interface InteractionAdmission<Result = unknown> {
  readonly accepted: boolean;
  readonly duplicate: boolean;
  readonly generation: number;
  readonly snapshot?: TurnSnapshot<Result>;
  readonly reason?: 'pending' | 'conflict';
}

export class InteractionController<Payload = unknown, Result = unknown> {
  private readonly inFlight = new Map<string, Promise<InteractionAdmission<Result>>>();

  public constructor(
    private readonly processor: TurnProcessorPort<Payload, Result>,
    private readonly deduplicator = new InputDeduplicator(),
    private readonly interruptions = new InterruptionCoordinator(),
  ) {}

  public async accept(input: InteractionInput<Payload>): Promise<InteractionAdmission<Result>> {
    this.validate(input);
    const claim = this.deduplicator.claim(input);
    if (claim.kind === 'conflict') {
      return { accepted: false, duplicate: false, generation: 0, reason: 'conflict' };
    }
    if (claim.kind === 'duplicate_pending') {
      const pending = this.inFlight.get(input.deduplication_key);
      if (!pending) {
        return { accepted: true, duplicate: true, generation: 0, reason: 'pending' };
      }
      const result = await pending;
      return { ...result, duplicate: true };
    }
    if (claim.kind === 'duplicate_completed') {
      return {
        accepted: true,
        duplicate: true,
        generation: claim.snapshot.generation,
        snapshot: claim.snapshot as TurnSnapshot<Result>,
      };
    }

    const processing = this.processAccepted(input);
    this.inFlight.set(input.deduplication_key, processing);
    try {
      return await processing;
    } finally {
      if (this.inFlight.get(input.deduplication_key) === processing) {
        this.inFlight.delete(input.deduplication_key);
      }
    }
  }

  private async processAccepted(
    input: InteractionInput<Payload>,
  ): Promise<InteractionAdmission<Result>> {
    const routeKey = interactionRouteKey(input);
    const active = this.interruptions.begin(routeKey);
    try {
      const produced = await this.processor.process(input, active.generation, active.signal);
      const snapshot = this.interruptions.isCurrent(routeKey, active.generation)
        ? produced
        : {
            turn_id: input.conversation.interaction_id,
            generation: active.generation,
            status: 'interrupted' as const,
            terminal_reason: 'stale_generation',
          };
      this.deduplicator.complete(input, snapshot);
      return { accepted: true, duplicate: false, generation: active.generation, snapshot };
    } catch (error) {
      if (active.signal.aborted) {
        const snapshot: TurnSnapshot<Result> = {
          turn_id: input.conversation.interaction_id,
          generation: active.generation,
          status: 'interrupted',
          terminal_reason: String(active.signal.reason || 'interrupted'),
        };
        this.deduplicator.complete(input, snapshot);
        return { accepted: true, duplicate: false, generation: active.generation, snapshot };
      }
      this.deduplicator.release(input);
      throw error;
    } finally {
      this.interruptions.finish(routeKey, active.generation);
    }
  }

  public interrupt(conversationId: string, threadId: string, reason?: string): number {
    return this.interruptions.interrupt(`${conversationId}\u0000${threadId}`, reason);
  }

  private validate(input: InteractionInput<Payload>): void {
    for (const [name, value] of [
      ['input_id', input.input_id],
      ['deduplication_key', input.deduplication_key],
      ['payload_digest', input.payload_digest],
      ['interaction_id', input.conversation?.interaction_id],
      ['conversation_id', input.conversation?.conversation_id],
      ['thread_id', input.conversation?.thread_id],
    ] as const) {
      if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError(`Interaction ${name} 不得为空`);
      }
    }
  }
}
