import type { InteractionInput } from '../interaction/input.js';
import type { TurnSnapshot } from './turn-snapshot.js';

export interface TurnProcessorPort<Payload = unknown, Result = unknown> {
  process(
    input: InteractionInput<Payload>,
    generation: number,
    signal: AbortSignal,
  ): Promise<TurnSnapshot<Result>>;
}

