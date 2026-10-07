import type { Invocation } from './invocation.js';

export interface ExecutionResultEvent {
  readonly event_id: string;
  readonly invocation: Invocation;
}
export interface ExecutionResultReceipt {
  readonly event_id: string;
  readonly invocation_id: string;
  readonly revision: number;
  readonly accepted: true;
}
