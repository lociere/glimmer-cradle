import { createHash } from 'node:crypto';

export type ExecutionState = 'prepared' | 'authorized' | 'dispatched' | 'succeeded' | 'failed' | 'unknown';
export interface ExecutionTarget {
  readonly executor_id: string;
  readonly capability_id: string;
  readonly definition_revision: string;
}
export interface InvocationRequest {
  readonly invocation_id: string;
  readonly scope_id: string;
  readonly idempotency_key: string;
  readonly target: ExecutionTarget;
  readonly input: unknown;
  /** 只引用交互事实；Conversation 独占线程/隐私/因果拓扑。 */
  readonly interaction?: { readonly conversation_id: string; readonly source_fact_id: string };
}
export interface Invocation {
  readonly invocation_id: string;
  readonly scope_id: string;
  readonly idempotency_key: string;
  readonly target: ExecutionTarget;
  readonly interaction: InvocationRequest['interaction'] | null;
  readonly request_digest: string;
  readonly state: ExecutionState;
  readonly revision: number;
  readonly attempt: number;
  readonly owner_id: string | null;
  readonly authorization: unknown;
  readonly result: unknown;
  readonly error_code: string | null;
  readonly side_effects: 'not_dispatched' | 'confirmed' | 'none' | 'unknown';
  readonly created_at: number;
  readonly updated_at: number;
}
export class ExecutionConflictError extends Error {}
export class ExecutionRecoveryRequiredError extends Error {
  public constructor(public readonly invocationId: string) {
    super(`Execution 终态不明，需要恢复（invocation_id=${invocationId}）`);
    this.name = 'ExecutionRecoveryRequiredError';
  }
}

/** 摘要拒绝非 JSON/稀疏数组；不把 undefined、NaN 或有 getter 的对象悄悄改写成另一请求。 */
export function executionJson(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== 'object' || seen.has(value)) throw new ExecutionConflictError('Execution JSON 无效');
  seen.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length || Object.values(descriptors).some(item => item.get || item.set)) {
      throw new ExecutionConflictError('Execution JSON 不允许 symbol/accessor');
    }
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) throw new ExecutionConflictError('Execution JSON 数组无效');
      return `[${Array.from(value, item => executionJson(item, seen)).join(',')}]`;
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new ExecutionConflictError('Execution JSON object 无效');
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${executionJson((value as Record<string, unknown>)[key], seen)}`).join(',')}}`;
  } finally { seen.delete(value); }
}
export function executionDigest(value: unknown): string {
  const document = executionJson(value);
  if (Buffer.byteLength(document, 'utf8') > 64 * 1024) throw new ExecutionConflictError('Execution document 超过 64 KiB');
  return createHash('sha256').update(document).digest('hex');
}
export function assertExecutionId(value: string): void {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > 4096) {
    throw new ExecutionConflictError('Execution identity 无效');
  }
}
export function assertExecutionTime(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0) throw new ExecutionConflictError('Execution UTC 时间无效');
}
export function invocationDigest(request: InvocationRequest): string {
  for (const value of [request.invocation_id, request.scope_id, request.idempotency_key,
    request.target.executor_id, request.target.capability_id, request.target.definition_revision]) assertExecutionId(value);
  if (request.interaction) {
    assertExecutionId(request.interaction.conversation_id); assertExecutionId(request.interaction.source_fact_id);
    if (request.scope_id !== request.interaction.conversation_id) throw new ExecutionConflictError('Execution 交互引用 scope 不匹配');
  }
  return executionDigest(request);
}
