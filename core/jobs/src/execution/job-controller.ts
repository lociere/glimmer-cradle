import { JobLeaseLostError, type Job } from './job.js';
import { JobCancellationController, jobAttemptKey } from './cancellation.js';
import type { JobHandlerPort, JobHandlerResult } from './job-handler-port.js';
import type { JobClockPort } from '../ports/clock-port.js';
import type { JobClaim, JobFinish, JobStorePort } from '../ports/job-store-port.js';
import { retryDelay, type RetryPolicy } from '../recovery/retry-policy.js';

export class JobController {
  private readonly handlers = new Map<string, JobHandlerPort>();
  private readonly cancellation = new JobCancellationController();
  private readonly active = new Map<string, Promise<Job | null>>();
  private accepting = true;

  public constructor(private readonly store: JobStorePort, private readonly clock: JobClockPort,
    private readonly retryPolicy: RetryPolicy) { retryDelay(1, retryPolicy); }

  public get isAccepting(): boolean { return this.accepting; }

  public get catalog(): ReadonlyArray<{ readonly kind: string; readonly retry_mode: Job['retry_mode'] }> {
    return [...this.handlers.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, handler]) => Object.freeze({ kind, retry_mode: handler.retry_mode }));
  }

  public hasHandler(kind: string): boolean { return this.accepting && this.handlers.has(kind); }

  /** App 撤销注册不撤销已开始的副作用；在途仍由原 lease/取消机制收尾。 */
  public unregister(kind: string): boolean { return this.handlers.delete(kind); }

  public register(handler: JobHandlerPort): void {
    if (!this.accepting || !handler.kind.trim() || this.handlers.has(handler.kind)
      || !['idempotent', 'reconcile'].includes(handler.retry_mode)) throw new Error('Job handler kind/政策冲突或已停止');
    this.handlers.set(handler.kind, Object.freeze({ kind: handler.kind, retry_mode: handler.retry_mode,
      execute: handler.execute.bind(handler) }));
  }

  public execute(claim: JobClaim): Promise<Job | null> {
    if (!this.accepting) return Promise.reject(new Error('JobController 已停止接纳'));
    const key = jobAttemptKey(claim.lease);
    const existing = this.active.get(key);
    if (existing) return existing;
    // execute 接纳后撤销注册只影响后续工作；不能在微任务启动前把原 claim 变成缺 handler。
    const job = this.store.load(claim.lease.job_id), handler = job ? this.handlers.get(job.kind) : undefined;
    const pending = Promise.resolve().then(() => this.run(claim, handler));
    this.active.set(key, pending);
    void pending.then(() => this.active.delete(key), () => this.active.delete(key));
    return pending;
  }

  public cancel(jobId: string, epoch: number, expectedRevision: number): Job | null {
    const cancelled = this.store.cancel(jobId, epoch, expectedRevision, this.clock.now());
    if (cancelled) this.cancellation.abortJob(jobId);
    return cancelled;
  }

  public async stop(): Promise<void> {
    this.accepting = false;
    this.cancellation.abortAll();
    const settled = await Promise.allSettled([...this.active.values()]);
    const failures = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Jobs 在途收尾失败');
  }

  private async run(claim: JobClaim, handler: JobHandlerPort | undefined): Promise<Job | null> {
    const { lease } = claim;
    // 执行只信持久事实，调用方的旧/伪造 claim snapshot 不能替换 kind、payload 或重试政策。
    const job = this.store.load(lease.job_id);
    if (!this.accepting || !job) throw new JobLeaseLostError('Job 已停止接纳或不存在');
    if (!this.store.isLeaseCurrent(lease, this.clock.now())) throw new JobLeaseLostError('Job lease 已失效');
    const signal = this.cancellation.enter(lease);
    const assertLease = () => {
      if (signal.aborted || !this.store.isLeaseCurrent(lease, this.clock.now())) {
        this.cancellation.abortLease(lease);
        throw new JobLeaseLostError('Job lease 已失效或取消');
      }
    };
    try {
      let outcome: JobFinish;
      if (!handler || handler.kind !== job.kind || handler.retry_mode !== job.retry_mode) {
        outcome = { status: 'dead_letter', error_code: 'handler_policy_unavailable' };
      } else {
        try {
          const result = await handler.execute({ job, lease, signal, assertLease,
            renew: leaseMs => {
              assertLease();
              if (!this.store.renew(lease, this.clock.now(), leaseMs)) throw new JobLeaseLostError('Job lease 无法续期');
            },
          }, job.payload);
          outcome = signal.aborted ? this.failure(job, 'execution_interrupted', true, 'unknown') : this.outcome(job, result);
        } catch {
          outcome = this.failure(job, 'handler_failed', true, 'unknown');
        }
      }
      this.store.finish(lease, this.clock.now(), outcome);
      return this.store.load(job.job_id);
    } finally { this.cancellation.leave(lease); }
  }

  private outcome(job: Job, result: JobHandlerResult): JobFinish {
    return result.status === 'succeeded' ? result : this.failure(job, result.error_code, result.retryable, result.effects);
  }

  private failure(job: Job, code: string, retryable: boolean, effects: 'none' | 'unknown'): JobFinish {
    const error_code = /^[a-z][a-z0-9_.:-]{0,127}$/.test(code) ? code : 'handler_failed';
    if (job.retry_mode !== 'idempotent' && effects === 'unknown') return { status: 'unknown', error_code };
    if (retryable && job.retry_mode === 'idempotent' && job.attempt < job.max_attempts) {
      return { status: 'retry_wait', error_code, next_due_at: this.clock.now() + retryDelay(job.attempt, this.retryPolicy) };
    }
    return { status: 'dead_letter', error_code };
  }
}
