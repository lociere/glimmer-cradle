import type { Job, JobAttempt, JobReconciliationEvidence, JobReconciliationReceipt, JobRequest, JobStateEvent } from '../execution/job.js';
import type { JobLease } from '../scheduling/job-lease.js';
import type { RetryPolicy } from '../recovery/retry-policy.js';
import type { JobTrigger, JobTriggerDefinition, JobTriggerEvent } from '../triggers/trigger.js';

export interface JobClaim { readonly job: Job; readonly lease: JobLease; }
export type JobClaimCandidate = Pick<Job, 'job_id' | 'revision'>;
/** producer 的不可变源信封摘要；Jobs 不解释其中的领域含义。 */
export interface JobSource { readonly source_id: string; readonly source_request_id: string; readonly input_digest: string; }
export interface JobSubmission {
  readonly job: Job | null;
  readonly job_id: string;
  readonly revision: number;
  readonly duplicate: boolean;
}
export interface JobFinish {
  readonly status: 'succeeded' | 'retry_wait' | 'dead_letter' | 'unknown';
  readonly error_code?: string;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly next_due_at?: number;
}

export interface JobStorePort {
  activateAuthority(epoch: number, now: number): void;
  loadAuthorityEpoch(): number | null;
  enqueue(request: JobRequest, epoch: number, now: number): JobSubmission;
  /** 源 inbox 与 enqueue 同事务；重放沿用首次政策，不沿用可变 retry due。 */
  enqueueSource(source: JobSource, request: JobRequest, epoch: number, now: number): JobSubmission;
  load(jobId: string): Job | null;
  /** 有界、稳定分页；App 选择已注册的 kind，不从内存 task 列表猜测恢复集合。 */
  listUnknown(epoch: number, kind: string, limit: number, afterJobId?: string): Job[];
  /** 接纳扫描按 job_id 稳定分页；读快照不消耗 attempt，claim 时须重验 revision。 */
  listDue(epoch: number, kind: string, now: number, limit: number, afterJobId?: string): Job[];
  listAttempts(jobId: string): JobAttempt[];
  reconcile(evidence: JobReconciliationEvidence, epoch: number, expectedRevision: number, now: number,
    policy: RetryPolicy): JobReconciliationReceipt;
  readOutbox(epoch: number, limit: number, kind?: string): JobStateEvent[];
  hasPendingKind(epoch: number, kind: string): boolean;
  /** 只有接收方已原子提交业务变化与 event_id inbox 后才能确认。 */
  acknowledgeOutbox(eventId: string, epoch: number, now: number): boolean;
  claim(epoch: number, ownerId: string, now: number, leaseMs: number, kind?: string, candidate?: JobClaimCandidate): JobClaim | null;
  renew(lease: JobLease, now: number, leaseMs: number): boolean;
  isLeaseCurrent(lease: JobLease, now: number): boolean;
  finish(lease: JobLease, now: number, outcome: JobFinish): boolean;
  cancel(jobId: string, epoch: number, expectedRevision: number, now: number): Job | null;
  recoverExpired(epoch: number, now: number, policy: RetryPolicy): number;
  pruneTerminal(epoch: number, before: number): number;
  registerTrigger(definition: JobTriggerDefinition, epoch: number, now: number): JobTrigger;
  loadTrigger(triggerId: string): JobTrigger | null;
  setTriggerEnabled(triggerId: string, epoch: number, expectedRevision: number, enabled: boolean, now: number): JobTrigger | null;
  emitEvent(triggerId: string, event: JobTriggerEvent, epoch: number, now: number): JobSubmission;
  materializeDue(epoch: number, now: number, limit: number): JobSubmission[];
}
