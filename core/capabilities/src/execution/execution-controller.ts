import { randomUUID } from 'node:crypto';
import { executionDigest, executionJson, invocationDigest, ExecutionConflictError, ExecutionRecoveryRequiredError,
  type Invocation, type InvocationRequest } from './invocation.js';
import type { ExecutionJournal } from './execution-journal.js';
import type { ExecutorPort, ExecutionOutcome } from './executor-port.js';

function freeze(value: unknown): void {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
}

/** 不自动重试/接管不明派发；owner 只标识本实例，不替代全局 authority/fencing。 */
export class ExecutionController {
  private readonly active = new Map<string, { digest: string; abort: AbortController; promise: Promise<Invocation> }>();
  private stopped = false;
  public constructor(private readonly journal: ExecutionJournal, private readonly now: () => number = Date.now,
    private readonly ownerId: string = randomUUID()) {}

  public execute(request: InvocationRequest, executor: ExecutorPort, signal?: AbortSignal): Promise<Invocation> {
    if (this.stopped) return Promise.reject(new Error('Execution 已停止接纳'));
    let digest: string;
    let snapshot: InvocationRequest;
    try { digest = invocationDigest(request); snapshot = JSON.parse(executionJson(request)); freeze(snapshot); }
    catch (error) { return Promise.reject(error); }
    const current = this.active.get(request.invocation_id);
    // 第二个等待者的取消不能代替实际 dispatch owner 的取消/终态。
    if (current) return current.digest === digest ? current.promise : Promise.reject(new ExecutionConflictError('Execution 进行中 identity 冲突'));
    const abort = new AbortController();
    const cancel = () => abort.abort(signal?.reason);
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
    const promise = this.run(snapshot, executor, abort.signal).finally(() => {
      signal?.removeEventListener('abort', cancel);
      this.active.delete(snapshot.invocation_id);
    });
    this.active.set(snapshot.invocation_id, { digest, abort, promise });
    return promise;
  }
  public async stop(): Promise<void> {
    this.stopped = true;
    for (const value of this.active.values()) value.abort.abort(new Error('Execution 正在排空'));
    await Promise.allSettled([...this.active.values()].map(value => value.promise));
  }
  public resultEvent(invocationId: string): import('./execution-journal.js').ExecutionResultEvent | null {
    const invocation = this.journal.load(invocationId);
    if (!invocation || !['succeeded', 'failed', 'unknown'].includes(invocation.state)) return null;
    return { event_id: executionDigest([invocationId, invocation.revision]), invocation };
  }
  private async run(request: InvocationRequest, executor: ExecutorPort, signal: AbortSignal): Promise<Invocation> {
    signal.throwIfAborted();
    let invocation = this.journal.prepare(request, this.now());
    if (invocation.state === 'succeeded' || invocation.state === 'failed') return invocation;
    if (invocation.state === 'dispatched' || invocation.state === 'unknown') throw new ExecutionRecoveryRequiredError(request.invocation_id);
    const authorization = await executor.authorize(request, signal);
    if (typeof authorization.allowed !== 'boolean') throw new ExecutionConflictError('Execution authorization 无效');
    signal.throwIfAborted();
    invocation = this.journal.authorize(invocation, authorization.decision, this.now());
    if (!authorization.allowed) return this.journal.reject(invocation, 'authorization_denied', this.now());
    if (!executor.validateBeforeDispatch(request)) return this.journal.reject(invocation, 'revoked_before_dispatch', this.now());
    signal.throwIfAborted();
    invocation = this.journal.dispatch(invocation, this.ownerId, this.now());
    let outcome: ExecutionOutcome;
    try { outcome = await executor.execute(request, signal); }
    catch { outcome = { state: 'unknown', error_code: 'executor_unconfirmed', side_effects: 'unknown' }; }
    // 取消后真实接收方仍能确认结果，不把已知成功降为 unknown。
    try { invocation = this.journal.finish(invocation, outcome, this.now()); }
    catch { throw new ExecutionRecoveryRequiredError(request.invocation_id); }
    if (invocation.state === 'unknown') throw new ExecutionRecoveryRequiredError(request.invocation_id);
    return invocation;
  }
}
