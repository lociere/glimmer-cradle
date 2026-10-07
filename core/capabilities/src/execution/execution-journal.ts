import type { Invocation, InvocationRequest } from './invocation.js';
import type { ExecutionOutcome } from './executor-port.js';

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

export interface ExecutionJournal {
  prepare(request: InvocationRequest, now: number): Invocation;
  load(invocationId: string): Invocation | null;
  authorize(invocation: Invocation, decision: unknown, now: number): Invocation;
  dispatch(invocation: Invocation, ownerId: string, now: number): Invocation;
  reject(invocation: Invocation, errorCode: string, now: number): Invocation;
  finish(invocation: Invocation, outcome: ExecutionOutcome, now: number): Invocation;
  readOutbox(limit: number, interactionOnly?: boolean): ExecutionResultEvent[];
  acknowledgeOutbox(receipt: ExecutionResultReceipt, now: number): boolean;
  close(): void;
}
