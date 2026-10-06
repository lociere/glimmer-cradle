export interface JobLease {
  readonly job_id: string;
  readonly authority_epoch: number;
  readonly fencing_token: number;
  readonly owner_id: string;
}

export function validateLeaseWindow(now: number, duration: number): void {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(duration) || duration <= 0
    || !Number.isSafeInteger(now + duration)) throw new Error('Job lease 时间无效');
}
