import type { Job, JobRequest } from '../execution/job.js';
import type { JobLease } from '../scheduling/job-lease.js';
import type { RetryPolicy } from '../recovery/retry-policy.js';

export interface JobClaim { readonly job: Job; readonly lease: JobLease; }
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
  enqueue(request: JobRequest, epoch: number, now: number): JobSubmission;
  load(jobId: string): Job | null;
  claim(epoch: number, ownerId: string, now: number, leaseMs: number): JobClaim | null;
  renew(lease: JobLease, now: number, leaseMs: number): boolean;
  isLeaseCurrent(lease: JobLease, now: number): boolean;
  finish(lease: JobLease, now: number, outcome: JobFinish): boolean;
  cancel(jobId: string, epoch: number, expectedRevision: number, now: number): Job | null;
  recoverExpired(epoch: number, now: number, policy: RetryPolicy): number;
  pruneTerminal(epoch: number, before: number): number;
}
