import type { JobLease } from '../scheduling/job-lease.js';

export function jobAttemptKey(lease: JobLease): string {
  return JSON.stringify([lease.job_id, lease.authority_epoch, lease.fencing_token, lease.owner_id]);
}

export class JobCancellationController {
  private readonly attempts = new Map<string, { lease: JobLease; controller: AbortController }>();

  public enter(lease: JobLease): AbortSignal {
    const key = jobAttemptKey(lease);
    if (this.attempts.has(key)) throw new Error('Job attempt 已执行');
    const controller = new AbortController();
    this.attempts.set(key, { lease, controller });
    return controller.signal;
  }

  public leave(lease: JobLease): void { this.attempts.delete(jobAttemptKey(lease)); }
  public abortLease(lease: JobLease): void { this.attempts.get(jobAttemptKey(lease))?.controller.abort(); }
  public abortJob(jobId: string): void {
    for (const attempt of this.attempts.values()) if (attempt.lease.job_id === jobId) attempt.controller.abort();
  }
  public abortAll(): void { for (const attempt of this.attempts.values()) attempt.controller.abort(); }
}
