import type { JobClockPort } from '../ports/clock-port.js';
import type { JobStorePort } from '../ports/job-store-port.js';
import type { RetryPolicy } from './retry-policy.js';
import { JobConflictError, type JobReconciliationReceipt } from '../execution/job.js';
import type { JobReconciliationPort, JobStateReceiverPort } from '../execution/job-handler-port.js';

export class JobRecoveryController {
  public constructor(private readonly store: JobStorePort, private readonly clock: JobClockPort,
    private readonly epoch: number, private readonly policy: RetryPolicy) {}

  public recoverExpired(): number { return this.store.recoverExpired(this.epoch, this.clock.now(), this.policy); }

  public async deliverOutbox(port: JobStateReceiverPort, limit: number, signal?: AbortSignal, kind?: string): Promise<number> {
    signal?.throwIfAborted();
    const events = this.store.readOutbox(this.epoch, limit, kind);
    let delivered = 0;
    for (const event of events) {
      signal?.throwIfAborted();
      const receipt = await port.accept(event, signal);
      signal?.throwIfAborted();
      if (receipt?.accepted !== true || receipt.event_id !== event.event_id) {
        throw new JobConflictError('Job outbox receiver 确认身份不匹配');
      }
      if (!this.store.acknowledgeOutbox(event.event_id, this.epoch, this.clock.now())) {
        throw new JobConflictError('Job outbox 待确认事实丢失');
      }
      delivered += 1;
    }
    return delivered;
  }

  public async reconcile(jobId: string, port: JobReconciliationPort, signal?: AbortSignal): Promise<JobReconciliationReceipt> {
    signal?.throwIfAborted();
    const job = this.store.load(jobId);
    if (!job || job.status !== 'unknown') return { status: 'stale', job };
    if (port.kind !== job.kind) throw new JobConflictError('Job reconciliation owner 不匹配');
    const attempt = this.store.listAttempts(jobId).find(value => value.attempt === job.attempt);
    if (!attempt || attempt.status !== 'unknown') throw new JobConflictError('Job unknown attempt 依据丢失');
    const evidence = await port.query(job, attempt, signal);
    signal?.throwIfAborted();
    if (!evidence) return { status: 'unavailable', job: this.store.load(jobId) };
    if (evidence.job_id !== job.job_id || evidence.scope_id !== job.scope_id
      || evidence.attempt !== attempt.attempt || evidence.authority_epoch !== attempt.authority_epoch
      || evidence.fencing_token !== attempt.fencing_token || evidence.owner_id !== attempt.owner_id) {
      throw new JobConflictError('Job reconciliation evidence identity 不匹配');
    }
    return this.store.reconcile(evidence, this.epoch, job.revision, this.clock.now(), this.policy);
  }
}
