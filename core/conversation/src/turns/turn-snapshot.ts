export type TurnProcessingStatus = 'accepted' | 'running' | 'completed' | 'interrupted' | 'failed';

export interface TurnSnapshot<Result = unknown> {
  readonly turn_id: string;
  readonly generation: number;
  readonly status: TurnProcessingStatus;
  readonly result?: Result;
  readonly terminal_reason?: string;
}

/** Python Conversation 持久确认必须绑定接纳时的内容摘要。 */
export interface PersistedTurnSnapshot<Result = unknown> extends TurnSnapshot<Result> {
  readonly payload_digest: string;
}
