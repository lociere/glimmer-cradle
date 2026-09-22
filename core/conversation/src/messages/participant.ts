export type ParticipantRole = 'user' | 'assistant';

export interface ConversationParticipant {
  readonly participant_id: string;
  readonly role: ParticipantRole;
  readonly display_name?: string;
}

export function assertParticipant(participant: ConversationParticipant): void {
  if (!participant.participant_id.trim()) {
    throw new Error('participant_id 不得为空');
  }
  if (participant.display_name !== undefined && !participant.display_name.trim()) {
    throw new Error('display_name 不得为空白');
  }
}
