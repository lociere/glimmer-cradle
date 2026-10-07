import type { Invocation, InvocationRequest } from './invocation.js';
import type { ExecutionOutcome } from './executor-port.js';
import type { ExecutionResultEvent, ExecutionResultReceipt } from './result-outbox.js';

export interface ExecutionJournal {
  prepare(request: InvocationRequest, now: number): Invocation;
  load(invocationId: string): Invocation | null;
  authorize(invocation: Invocation, decision: unknown, now: number): Invocation;
  dispatch(invocation: Invocation, ownerId: string, now: number): Invocation;
  reject(invocation: Invocation, errorCode: string, now: number): Invocation;
  finish(invocation: Invocation, outcome: ExecutionOutcome, now: number): Invocation;
  readOutbox(limit: number): ExecutionResultEvent[];
  acknowledgeOutbox(receipt: ExecutionResultReceipt, now: number): boolean;
  close(): void;
}
