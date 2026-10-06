import { setTimeout as delay } from 'node:timers/promises';
import { JobController, JobRecoveryController, JobScheduler, type JobClockPort,
  type JobStorePort, type JobStateReceiverPort, type RetryPolicy } from '@glimmer-cradle/jobs';
import { ServiceErrorCode } from '@glimmer-cradle/contracts/glimmer/common/v1/service_contract_pb';
import { CognitionClient, HostCognitionError } from '../adapters/protocol/cognition-client.js';
import { MEMORY_JOB_KIND, type MemoryJobSubmissionPolicy } from '../adapters/protocol/job-mapper.js';
import { CognitionJobAdapter } from './cognition-job-adapter.js';

export interface HostJobsOptions {
  readonly store: JobStorePort;
  readonly clock: JobClockPort;
  /** 来自持久 authority owner；进程重启不能自行复用或随机生成 epoch。 */
  readonly epoch: number;
  readonly owner_id: string;
  /** 当前 generation 的独占 client；controller 停机后撤销。 */
  readonly cognition: CognitionClient;
  readonly poll_interval_ms: number;
  readonly batch_size: number;
  readonly lease_ms: number;
  readonly submission_policy: MemoryJobSubmissionPolicy;
  readonly retry_policy: RetryPolicy;
  readonly state_receiver?: JobStateReceiverPort;
}
export interface HostJobsSnapshot {
  readonly status: 'idle' | 'starting' | 'ready' | 'degraded' | 'failed' | 'stopping' | 'stopped';
  readonly completed_cycles: number;
  readonly error_code: 'cognition_unavailable' | 'jobs_recovery_pending' | 'jobs_cycle_failed' | null;
}

/** 仅监督已装配的 Memory Jobs 链路；不代表整个 Host/产品已 ready，也不持有领域政策。 */
export class HostJobsController {
  private readonly options: HostJobsOptions;
  private readonly adapter: CognitionJobAdapter;
  private readonly controller: JobController;
  private readonly recovery: JobRecoveryController;
  private readonly scheduler: JobScheduler;
  private readonly cancellation = new AbortController();
  private state: HostJobsSnapshot = { status: 'idle', completed_cycles: 0, error_code: null };
  private cursor = '';
  private starting?: Promise<HostJobsSnapshot>;
  private loop?: Promise<void>;
  private stopping?: Promise<void>;

  public constructor(options: HostJobsOptions) {
    if (![options.epoch, options.poll_interval_ms, options.batch_size, options.lease_ms]
      .every(value => Number.isSafeInteger(value) && value > 0) || options.batch_size > 1000
      || options.poll_interval_ms > 2_147_483_647
      || !options.owner_id.trim() || !Number.isSafeInteger(options.submission_policy.debounce_ms)
      || options.submission_policy.debounce_ms < 0 || !Number.isSafeInteger(options.submission_policy.max_attempts)
      || options.submission_policy.max_attempts < 1) throw new Error('Host Jobs 装配参数无效');
    // 一个实例持有一份政策；热变更须 drain 后重新装配，不能改变未确认源的原 request。
    this.options = { ...options, submission_policy: { ...options.submission_policy }, retry_policy: { ...options.retry_policy } };
    this.adapter = new CognitionJobAdapter(options.cognition);
    this.controller = new JobController(options.store, options.clock, this.options.retry_policy);
    this.controller.register(this.adapter);
    this.recovery = new JobRecoveryController(options.store, options.clock, options.epoch, this.options.retry_policy);
    this.scheduler = new JobScheduler(options.store, this.controller, options.clock, options.epoch, options.owner_id,
      options.lease_ms, MEMORY_JOB_KIND);
  }

  public get snapshot(): HostJobsSnapshot { return { ...this.state }; }

  public start(): Promise<HostJobsSnapshot> {
    if (this.stopping || this.cancellation.signal.aborted) return Promise.reject(new Error('Host Jobs 实例已撤销'));
    if (this.starting) return this.starting;
    this.state = { ...this.state, status: 'starting' };
    this.starting = this.begin();
    // 停机可能先于调用方 await；仍返回原 rejection，不产生后台未观察 Promise。
    void this.starting.catch(() => undefined);
    return this.starting;
  }

  public stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.state = { ...this.state, status: 'stopping' };
    this.cancellation.abort();
    this.stopping = this.drain();
    return this.stopping;
  }

  private async begin(): Promise<HostJobsSnapshot> {
    try {
      this.options.store.activateAuthority(this.options.epoch, this.options.clock.now());
      await this.tick();
      this.cancellation.signal.throwIfAborted();
      this.loop = this.supervise();
      void this.loop.catch(() => undefined);
      return this.snapshot;
    } catch (error) {
      if (!this.cancellation.signal.aborted) await this.fail();
      throw error;
    }
  }

  private async supervise(): Promise<void> {
    try {
      while (!this.cancellation.signal.aborted) {
        // 前一轮完全结束才开启下一轮；只有一个可取消 timer，没有重叠 interval callback。
        await delay(this.options.poll_interval_ms, undefined, { signal: this.cancellation.signal });
        await this.tick();
      }
    } catch {
      if (!this.cancellation.signal.aborted) await this.fail();
    }
  }

  private async tick(): Promise<void> {
    const { store, clock, epoch, submission_policy, batch_size, state_receiver } = this.options;
    const signal = this.cancellation.signal;
    signal.throwIfAborted();
    try {
      this.recovery.recoverExpired();
      await this.adapter.deliverRequests(store, clock, epoch, submission_policy, batch_size, signal);
      const unknown = store.listUnknown(epoch, MEMORY_JOB_KIND, batch_size, this.cursor);
      let degraded = false;
      for (const job of unknown) {
        this.cursor = job.job_id;
        try { await this.recovery.reconcile(job.job_id, this.adapter, signal); }
        catch (error) { if (this.unavailable(error)) degraded = true; else throw error; }
      }
      // 即使一个 owner 暂不可查询，也前进分页；下一轮回绕，不让首个 unknown 饿死其他工作。
      if (unknown.length < batch_size) this.cursor = '';
      signal.throwIfAborted();
      await this.scheduler.runDue(batch_size, signal);
      if (state_receiver) await this.recovery.deliverOutbox(state_receiver, batch_size, signal);
      signal.throwIfAborted();
      const pending = store.listUnknown(epoch, MEMORY_JOB_KIND, 1).length > 0;
      this.state = { status: degraded || pending ? 'degraded' : 'ready', completed_cycles: this.state.completed_cycles + 1,
        error_code: degraded ? 'cognition_unavailable' : pending ? 'jobs_recovery_pending' : null };
    } catch (error) {
      if (signal.aborted || !this.unavailable(error)) throw error;
      this.state = { ...this.state, status: 'degraded', error_code: 'cognition_unavailable' };
    }
  }

  private unavailable(error: unknown): boolean {
    return error instanceof HostCognitionError && [ServiceErrorCode.UNAVAILABLE, ServiceErrorCode.NOT_READY,
      ServiceErrorCode.DEADLINE_EXCEEDED].includes(error.code);
  }

  private async fail(): Promise<void> {
    this.state = { ...this.state, status: 'failed', error_code: 'jobs_cycle_failed' };
    this.cancellation.abort();
    try { await this.controller.stop(); } finally { this.options.cognition.close(); }
  }

  private async drain(): Promise<void> {
    // 先中止执行再等循环；client 必须留到独立封口 RPC 收尾，不能先断开接收端。
    const results = await Promise.allSettled([this.controller.stop(), this.starting, this.loop]);
    this.options.cognition.close();
    this.state = { ...this.state, status: 'stopped' };
    const failure = results[0];
    if (failure.status === 'rejected') throw failure.reason;
    // Store 由装配 owner 注入并拥有；stop 返回后该 owner 才可关闭数据库。
  }
}
