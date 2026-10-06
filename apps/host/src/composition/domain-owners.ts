import { AuthorityConflictError, HandoverController, isAuthorityCurrent, type AuthorityLease,
  type AuthorityStorePort } from '@glimmer-cradle/platform';
import { HostJobsController, type HostJobsOptions, type HostJobsSnapshot } from './host.js';

export interface HostJobsOwnerOptions extends Omit<HostJobsOptions, 'epoch'> {
  readonly authority: AuthorityStorePort;
  readonly authority_lease_ms: number;
  readonly renewal_interval_ms: number;
  /** 接纳显式 handover 的持久 receipt；不是自行指定 epoch。 */
  readonly initial_lease?: AuthorityLease;
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
      const priorJobEpoch = this.options.store.loadAuthorityEpoch(), priorAuthority = authority.load('jobs');
      // 缺失/局部回滚的 authority DB 不能靠重复启动追上已有业务计数；须恢复一致备份。
      if (priorJobEpoch !== null && (!priorAuthority || priorAuthority.epoch < priorJobEpoch)) {
        throw new AuthorityConflictError('Authority/Jobs 恢复切点不一致，须先恢复权威序列');
      }
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
      this.jobs = new HostJobsController({ ...this.options, epoch: this.lease.epoch, clock: { now: () => this.guardedNow() } });
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
