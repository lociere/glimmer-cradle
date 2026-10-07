import { AuthorityConflictError, HandoverController, isAuthorityCurrent, type AuthorityLease,
  type AuthorityStorePort } from '@glimmer-cradle/platform';
import { HostJobsController, type HostJobsOptions, type HostJobsSnapshot } from './host.js';
import { WorkerSupervisor, type WorkerSupervisorSnapshot } from '../supervision/worker-supervisor.js';
import type { WorkerSupervisorOptions } from '../supervision/worker-supervisor.js';
import { SqliteJobStore, type JobClockPort, type JobStateReceiverPort, type JobStorePort } from '@glimmer-cradle/jobs';
import { SqliteAuthorityStore } from '../adapters/platform/authority-store.js';
import { HostDataPaths } from '../adapters/platform/data-paths.js';
import { loadHostCognitionJobsConfiguration, type HostCognitionJobsConfiguration } from '../adapters/platform/host-configuration.js';
import { CognitionJobAdapter } from './cognition-job-adapter.js';
import { HostKnowledgeController, HostResourceContributions, type HostKnowledgeApproval, type HostKnowledgeSnapshot } from './extension-contributions.js';

export interface HostJobsOwnerOptions extends Omit<HostJobsOptions, 'epoch'> {
  readonly authority: AuthorityStorePort;
  readonly authority_lease_ms: number;
  readonly renewal_interval_ms: number;
  /** 接纳显式 handover 的持久 receipt；不是自行指定 epoch。 */
  readonly initial_lease?: AuthorityLease;
  /** 配置启动选择实际 Cognition inbox；未装配的手工 owner 不制造确认。 */
  readonly memory_state_feedback?: boolean;
}

export interface ConfiguredHostCognitionJobsOptions {
  readonly paths: HostDataPaths;
  readonly clock: JobClockPort;
  readonly owner_id: string;
  readonly worker: Omit<WorkerSupervisorOptions, 'app_root' | 'data_root' | 'console_path'
    | 'startup_timeout_ms' | 'shutdown_timeout_ms' | 'request_timeout_ms'>;
  readonly state_receiver?: JobStateReceiverPort;
  readonly resources?: HostResourceContributions;
}
export interface ConfiguredHostCognitionJobsSnapshot {
  readonly phase: 'idle' | 'starting' | 'active' | 'failed' | 'stopping' | 'stopped';
  readonly configuration: HostCognitionJobsConfiguration | null;
  readonly session: HostCognitionJobsSnapshot | null;
}

/** 从唯一配置与 resolver 启动实际 Worker/Jobs，拥有两个库，未完成 drain 不关闭资源。 */
export class ConfiguredHostCognitionJobsOwner {
  private readonly options: ConfiguredHostCognitionJobsOptions;
  private phase: ConfiguredHostCognitionJobsSnapshot['phase'] = 'idle';
  private configuration?: HostCognitionJobsConfiguration;
  private store?: SqliteJobStore;
  private authority?: SqliteAuthorityStore;
  private session?: HostCognitionJobsOwner;
  private starting?: Promise<ConfiguredHostCognitionJobsSnapshot>;
  private stopping?: Promise<void>;
  private stopRequested = false;
  public constructor(options: ConfiguredHostCognitionJobsOptions) {
    if (!options.owner_id.trim() || typeof options.clock.now !== 'function') throw new Error('Host 配置启动 identity/clock 无效');
    this.options = { ...options, worker: { ...options.worker, environment: { ...options.worker.environment } } };
  }
  public get snapshot(): ConfiguredHostCognitionJobsSnapshot {
    const session = this.session?.snapshot ?? null;
    return { phase: this.phase === 'active' && session?.phase === 'failed' ? 'failed' : this.phase,
      configuration: this.configuration ?? null, session };
  }
  public get knowledge(): HostKnowledgeController {
    if (this.snapshot.phase !== 'active' || !this.session) throw new Error('配置 Host 尚未激活');
    return this.session.knowledge;
  }
  public start(): Promise<ConfiguredHostCognitionJobsSnapshot> {
    if (this.stopRequested || this.snapshot.phase === 'failed') return Promise.reject(new Error('配置 Host 实例已撤销'));
    if (this.starting) return this.starting;
    this.phase = 'starting'; this.starting = this.begin(); void this.starting.catch(() => undefined); return this.starting;
  }
  public stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopRequested = true; this.phase = 'stopping';
    this.stopping = (async () => {
      try {
        await this.session?.stop();
        await this.starting?.catch(() => undefined);
        this.closeStores(); this.phase = 'stopped';
      } catch (error) { this.phase = 'failed'; throw error; }
    })();
    return this.stopping;
  }
  private async begin(): Promise<ConfiguredHostCognitionJobsSnapshot> {
    try {
      // 配置失败不能先创建库，恢复切点异常不能先单向绑定 Memory external。
      this.configuration = loadHostCognitionJobsConfiguration(this.options.paths);
      if (this.configuration.knowledge_approvals.length && !this.options.resources
        || this.options.resources && this.options.worker.capability_service !== this.options.resources) {
        throw new Error('Knowledge 必须装配同一真实 Resource 服务；审批不能静默忽略');
      }
      this.store = new SqliteJobStore(this.options.paths.jobs_database);
      this.authority = new SqliteAuthorityStore(this.options.paths.authority_database);
      assertJobsRestoration(this.store, this.authority);
      const worker = new WorkerSupervisor({ ...this.options.worker, ...this.configuration.worker,
        runtime_document: { ...this.options.worker.runtime_document, memory: this.configuration.memory_document },
        app_root: this.options.paths.app_root, data_root: this.options.paths.data_root, console_path: this.options.paths.worker_console });
      this.session = new HostCognitionJobsOwner({ worker,
        ...(this.options.resources ? { knowledge: { resources: this.options.resources, approvals: this.configuration.knowledge_approvals } } : {}),
        jobs: { ...this.configuration.jobs, ...this.configuration.authority,
        store: this.store, authority: this.authority, clock: this.options.clock, owner_id: this.options.owner_id,
        state_receiver: this.options.state_receiver, memory_state_feedback: true, planning_sources: true } });
      await this.session.start();
      if (this.stopRequested) throw new Error('配置 Host 启动已撤销');
      this.phase = 'active'; return this.snapshot;
    } catch (error) {
      if (!this.stopRequested) this.phase = 'failed';
      // 接收方/执行未 drain 时保留所有权，不用关闭底层 DB 伪造成功。
      await this.session?.stop(); this.closeStores(); throw error;
    }
  }
  private closeStores(): void {
    this.store?.close(); this.store = undefined;
    this.authority?.close(); this.authority = undefined;
  }
}

function assertJobsRestoration(store: JobStorePort, authority: AuthorityStorePort): number | null {
  const epoch = store.loadAuthorityEpoch(), current = authority.load('jobs');
  if (epoch !== null && (!current || current.epoch < epoch)) {
    throw new AuthorityConflictError('Authority/Jobs 恢复切点不一致，须先恢复权威序列');
  }
  return epoch;
}

export interface HostCognitionJobsOptions {
  readonly worker: WorkerSupervisor;
  readonly jobs: Omit<HostJobsOwnerOptions, 'cognition'>;
  readonly knowledge?: { readonly resources: HostResourceContributions; readonly approvals: readonly HostKnowledgeApproval[] };
}
export interface HostCognitionJobsSnapshot {
  readonly phase: 'idle' | 'starting' | 'active' | 'failed' | 'stopping' | 'stopped';
  readonly worker: WorkerSupervisorSnapshot;
  readonly jobs: HostJobsOwnerSnapshot | null;
  readonly knowledge: HostKnowledgeSnapshot | null;
}

/** 实际 Worker 与 Jobs 的局部生命周期；不替代整个产品的 ingress/readiness owner。 */
export class HostCognitionJobsOwner {
  private phase: HostCognitionJobsSnapshot['phase'] = 'idle';
  private jobs?: HostJobsOwner;
  private knowledgeController?: HostKnowledgeController;
  private starting?: Promise<HostCognitionJobsSnapshot>;
  private stopping?: Promise<void>;
  private lossTask?: Promise<void>;
  private unsubscribe?: () => void;
  private stopRequested = false;
  private readonly options: HostCognitionJobsOptions;
  public constructor(options: HostCognitionJobsOptions) {
    this.options = { worker: options.worker, knowledge: options.knowledge, jobs: { ...options.jobs,
      submission_policy: { ...options.jobs.submission_policy }, retry_policy: { ...options.jobs.retry_policy },
      ...(options.jobs.initial_lease ? { initial_lease: { ...options.jobs.initial_lease } } : {}) } };
  }
  public get snapshot(): HostCognitionJobsSnapshot {
    const jobs = this.jobs?.snapshot ?? null;
    const failed = jobs && (['failed', 'lease_lost'].includes(jobs.phase) || jobs.jobs?.status === 'failed');
    return { phase: this.phase === 'active' && failed ? 'failed' : this.phase, worker: this.options.worker.snapshot, jobs,
      knowledge: this.knowledgeController?.snapshot ?? null };
  }
  public get knowledge(): HostKnowledgeController {
    if (this.snapshot.phase !== 'active' || !this.knowledgeController) throw new Error('Knowledge 未装配或尚未激活');
    return this.knowledgeController;
  }
  public start(): Promise<HostCognitionJobsSnapshot> {
    if (this.stopRequested || this.snapshot.phase === 'failed') return Promise.reject(new Error('Host Worker/Jobs owner 已撤销'));
    if (this.starting) return this.starting;
    this.phase = 'starting';
    this.unsubscribe = this.options.worker.onFailure(() => {
      this.phase = 'failed';
      this.lossTask = this.drainDomains();
      void this.lossTask.catch(() => undefined);
    });
    this.starting = this.begin(); void this.starting.catch(() => undefined); return this.starting;
  }
  public stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopRequested = true; this.phase = 'stopping';
    // 尚未装配 Jobs 时立即中断启动屏障，不能等 startup deadline 才停止。
    if (!this.jobs) void this.options.worker.stop().catch(() => undefined);
    this.stopping = (async () => {
      let drained = false;
      try {
        await this.drainDomains();
        await this.starting?.catch(() => undefined);
        await this.lossTask;
        drained = true;
      } finally {
        try { await this.options.worker.stop(); this.phase = drained ? 'stopped' : 'failed'; }
        catch (error) { this.phase = 'failed'; throw error; }
        finally { this.unsubscribe?.(); this.unsubscribe = undefined; }
      }
    })();
    return this.stopping;
  }
  private async begin(): Promise<HostCognitionJobsSnapshot> {
    try {
      await this.options.worker.start();
      if (this.stopRequested || this.phase !== 'starting') throw new Error('Host Worker/Jobs 启动已撤销');
      const cognition = this.options.worker.createCognitionClient();
      try { this.jobs = new HostJobsOwner({ ...this.options.jobs, cognition }); }
      catch (error) { cognition.close(); throw error; }
      if (this.options.knowledge) {
        const client = this.options.worker.createCognitionClient();
        try {
          this.knowledgeController = new HostKnowledgeController(this.options.knowledge.resources, client,
            this.options.worker.snapshot.generation!, this.options.knowledge.approvals);
        } catch (error) { client.close(); throw error; }
        await this.knowledgeController.start();
      }
      await this.jobs.start();
      if (this.stopRequested || this.phase !== 'starting' || this.options.worker.snapshot.state !== 'ready') {
        throw new Error('Host Worker/Jobs 启动身份已撤销');
      }
      this.phase = 'active'; return this.snapshot;
    } catch (error) {
      if (!this.stopRequested) this.phase = 'failed';
      try { await this.drainDomains(); } finally { await this.options.worker.stop(); this.unsubscribe?.(); }
      throw error;
    }
  }
  private async drainDomains(): Promise<void> {
    const outcomes = await Promise.allSettled([this.knowledgeController?.stop(), this.jobs?.stop()]);
    const failures = outcomes.filter(value => value.status === 'rejected').map(value => value.reason);
    if (failures.length) throw new AggregateError(failures, 'Host 领域 drain 失败');
  }
}
type OwnerPhase = 'idle' | 'starting' | 'active' | 'transferring' | 'transferred' | 'lease_lost' | 'failed' | 'stopping' | 'stopped';
export interface HostJobsOwnerSnapshot {
  readonly phase: OwnerPhase;
  readonly lease: AuthorityLease | null;
  readonly jobs: HostJobsSnapshot | null;
}

/** Jobs store 的单一 aggregate 为 jobs；authority DB 与 Job DB 不能各自生成主 epoch。 */
export class HostJobsOwner {
  private readonly options: HostJobsOwnerOptions;
  private phase: OwnerPhase = 'idle';
  private lease: AuthorityLease | null = null;
  private jobs?: HostJobsController;
  private timer?: ReturnType<typeof setTimeout>;
  private starting?: Promise<HostJobsOwnerSnapshot>;
  private stopping?: Promise<void>;
  private lossTask?: Promise<void>;
  private transferTask?: Promise<AuthorityLease>;
  private transferIntent?: { nextOwnerId: string; transferId: string };

  public constructor(options: HostJobsOwnerOptions) {
    if (![options.authority_lease_ms, options.renewal_interval_ms].every(value => Number.isSafeInteger(value) && value > 0)
      || options.renewal_interval_ms >= options.authority_lease_ms || options.renewal_interval_ms > 2_147_483_647) {
      throw new AuthorityConflictError('Host Authority 续期窗口无效');
    }
    this.options = { ...options, submission_policy: { ...options.submission_policy }, retry_policy: { ...options.retry_policy },
      ...(options.initial_lease ? { initial_lease: { ...options.initial_lease } } : {}) };
  }
  public get snapshot(): HostJobsOwnerSnapshot {
    return { phase: this.phase, lease: this.lease ? { ...this.lease } : null, jobs: this.jobs?.snapshot ?? null };
  }
  public start(): Promise<HostJobsOwnerSnapshot> {
    if (this.phase !== 'idle' && this.phase !== 'starting' && this.phase !== 'active') {
      return Promise.reject(new AuthorityConflictError('Host Jobs owner 已撤销'));
    }
    if (this.starting) return this.starting;
    this.phase = 'starting';
    this.starting = this.begin();
    void this.starting.catch(() => undefined);
    return this.starting;
  }
  public stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.drain();
    return this.stopping;
  }
  public handover(nextOwnerId: string, transferId: string): Promise<AuthorityLease> {
    if (this.transferTask) return this.transferIntent?.nextOwnerId === nextOwnerId && this.transferIntent.transferId === transferId
      ? this.transferTask : Promise.reject(new AuthorityConflictError('Host 转移请求 identity 内容冲突'));
    if (!this.lease || this.phase !== 'active') return Promise.reject(new AuthorityConflictError('Host Jobs owner 不可转移'));
    this.phase = 'transferring';
    this.transferIntent = { nextOwnerId, transferId };
    const controller = new HandoverController(this.options.authority, this.options.clock);
    this.transferTask = controller.transfer(this.lease, nextOwnerId, transferId, {
      revokeAndDrain: async handover => {
        this.clearTimer();
        await this.jobs!.stop();
        return { transfer_id: handover.transfer_id, aggregate_id: handover.from.aggregate_id,
          owner_id: handover.from.owner_id, epoch: handover.from.epoch, fencing_token: handover.from.fencing_token, drained: true };
      },
    }, this.options.authority_lease_ms).then(next => {
      this.phase = 'transferred'; this.lease = null; return next;
    }, async error => {
      this.phase = 'failed'; this.clearTimer();
      try { await this.jobs?.stop(); } finally { this.options.cognition.close(); }
      throw error;
    });
    void this.transferTask.catch(() => undefined);
    return this.transferTask;
  }
  private async begin(): Promise<HostJobsOwnerSnapshot> {
    try {
      const { authority, owner_id, initial_lease, clock, authority_lease_ms } = this.options;
      const priorJobEpoch = assertJobsRestoration(this.options.store, authority);
      if (initial_lease) {
        const current = authority.load('jobs');
        if (initial_lease.aggregate_id !== 'jobs' || initial_lease.owner_id !== owner_id
          || !isAuthorityCurrent(current, initial_lease, clock.now()) || current!.revision !== initial_lease.revision) {
          throw new AuthorityConflictError('Host 转移接纳租约已失效');
        }
        this.lease = initial_lease;
      } else this.lease = authority.acquire('jobs', owner_id, clock.now(), authority_lease_ms);
      if (priorJobEpoch !== null && this.lease.epoch <= priorJobEpoch) {
        throw new AuthorityConflictError('新 Host lease 未领先已有 Jobs epoch，须受控恢复');
      }
      this.jobs = new HostJobsController({ ...this.options, epoch: this.lease.epoch, clock: { now: () => this.guardedNow() },
        state_receiver: this.options.state_receiver ?? (this.options.memory_state_feedback
          ? new CognitionJobAdapter(this.options.cognition).stateReceiver(this.lease.epoch) : undefined) });
      this.scheduleRenewal();
      await this.jobs.start();
      if (this.phase !== 'starting') throw new AuthorityConflictError('Host Jobs 启动身份已撤销');
      this.phase = 'active';
      return this.snapshot;
    } catch (error) {
      if (this.phase === 'starting') this.phase = 'failed';
      this.clearTimer();
      try { await this.jobs?.stop(); }
      finally {
        this.options.cognition.close();
        if (this.lease) this.options.authority.release(this.lease, this.options.clock.now());
      }
      throw error;
    }
  }
  private guardedNow(): number {
    const now = this.options.clock.now(), lease = this.lease;
    const current = this.options.authority.load('jobs');
    const draining = ['transferring', 'stopping', 'lease_lost'].includes(this.phase);
    const same = lease && current && current.owner_id === lease.owner_id && current.epoch === lease.epoch
      && current.fencing_token === lease.fencing_token && current.status !== 'released';
    // 受控 drain 只完成旧执行的收尾；Jobs 接纳已撤销，切到更高 epoch 后这里仍拒绝。
    if (!lease || !isAuthorityCurrent(current, lease, now) && !(draining && same)) {
      throw new AuthorityConflictError('Host Authority lease 已撤销');
    }
    return now;
  }
  private scheduleRenewal(): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      try {
        if (!this.lease) return;
        const renewed = this.options.authority.renew(this.lease, this.options.clock.now(), this.options.authority_lease_ms);
        if (!renewed) throw new AuthorityConflictError('Host Authority 续期被 fencing');
        this.lease = renewed; this.scheduleRenewal();
      } catch {
        this.phase = 'lease_lost';
        this.lossTask = this.jobs!.stop();
        void this.lossTask.catch(() => { this.phase = 'failed'; });
      }
    }, this.options.renewal_interval_ms);
  }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  private async drain(): Promise<void> {
    if (this.transferTask) await this.transferTask.catch(() => undefined);
    this.phase = 'stopping';
    try {
      // 正常 drain 期间保持续期，避免在独立封口 RPC 完成前让租约自然过期。
      await this.jobs?.stop();
      await this.starting?.catch(() => undefined);
      await this.lossTask;
    } finally {
      this.clearTimer(); this.options.cognition.close();
      if (this.lease) this.options.authority.release(this.lease, this.options.clock.now());
      this.phase = 'stopped';
    }
  }
}
