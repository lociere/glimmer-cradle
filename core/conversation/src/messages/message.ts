import { assertParticipant, type ConversationParticipant } from './participant.js';

export interface ConversationMessage<TContentPart = unknown> {
  readonly message_id: string;
  readonly conversation_id: string;
  readonly thread_id: string;
  readonly interaction_id: string;
  readonly participant: ConversationParticipant;
  readonly content: readonly TContentPart[];
  readonly occurred_at: string;
}

export function assertConversationMessage(message: ConversationMessage): void {
  for (const [field, value] of Object.entries({
    message_id: message.message_id,
    conversation_id: message.conversation_id,
    thread_id: message.thread_id,
    interaction_id: message.interaction_id,
    occurred_at: message.occurred_at,
  })) {
    if (!value.trim()) {
      throw new Error(`${field} 不得为空`);
    }
  }
  if (message.content.length === 0) {
    throw new Error('Conversation Message 至少包含一个 ContentPart');
  }
  assertParticipant(message.participant);
}
