import type { ConversationContext } from '../binding/binding.js';

export interface InteractionInput<Payload = unknown> {
  readonly input_id: string;
  readonly deduplication_key: string;
  readonly payload_digest: string;
  readonly conversation: ConversationContext;
  readonly received_at: string;
  readonly payload: Payload;
}

export function interactionRouteKey(input: Pick<InteractionInput, 'conversation'>): string {
  return `${input.conversation.conversation_id}\u0000${input.conversation.thread_id}`;
}

