import type { InvocationRequest } from './invocation.js';

export type ExecutionOutcome =
  | { readonly state: 'succeeded'; readonly result: unknown; readonly side_effects: 'confirmed' | 'none' }
  | { readonly state: 'failed'; readonly error_code: string; readonly side_effects: 'none' }
  | { readonly state: 'unknown'; readonly error_code: string; readonly side_effects: 'unknown' };

/** 由实际接收方判断结果；异常/取消本身不构成“副作用未发生”的证据。 */
export interface ExecutorPort {
  authorize(request: InvocationRequest, signal: AbortSignal): Promise<{ allowed: boolean; decision: unknown }>;
  /** 同步复验，返回后到 journal CAS/调用接收方之间不得 await。 */
  validateBeforeDispatch(request: InvocationRequest): boolean;
  execute(request: InvocationRequest, signal: AbortSignal): Promise<ExecutionOutcome>;
}
