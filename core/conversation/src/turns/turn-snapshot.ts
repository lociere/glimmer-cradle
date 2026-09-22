export type TurnProcessingStatus = 'accepted' | 'running' | 'completed' | 'interrupted' | 'failed';

export interface TurnSnapshot<Result = unknown> {
  readonly turn_id: string;
  readonly generation: number;
  readonly status: TurnProcessingStatus;
  readonly result?: Result;
  readonly terminal_reason?: string;
}

