export type JobStatus = 'queued' | 'running' | 'retry_wait' | 'succeeded' | 'cancelled' | 'dead_letter' | 'unknown';
export type JobRetryMode = 'idempotent' | 'reconcile';

export interface JobRequest {
  readonly job_id: string;
  readonly scope_id: string;
  readonly goal_id: string;
  readonly kind: string;
  readonly idempotency_key: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly due_at: number;
  readonly retry_mode: JobRetryMode;
  readonly max_attempts: number;
}

export interface Job extends JobRequest {
  readonly status: JobStatus;
  readonly revision: number;
  readonly attempt: number;
  readonly authority_epoch: number;
  readonly fencing_token: number;
  readonly lease_owner: string | null;
  readonly lease_until: number | null;
  readonly error_code: string | null;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export class JobConflictError extends Error {}
export class JobLeaseLostError extends Error {}
export class JobAuthorityError extends Error {}

export function validateJobRequest(request: JobRequest): void {
  for (const value of [request.job_id, request.scope_id, request.goal_id, request.kind, request.idempotency_key]) {
    if (typeof value !== 'string' || !value.trim()) throw new JobConflictError('Job identity 不得为空');
  }
  if (!Number.isSafeInteger(request.due_at) || request.due_at < 0
    || !Number.isSafeInteger(request.max_attempts) || request.max_attempts < 1
    || !['idempotent', 'reconcile'].includes(request.retry_mode)) {
    throw new JobConflictError('Job schedule/retry policy 无效');
  }
  if (!request.payload || Array.isArray(request.payload) || typeof request.payload !== 'object') {
    throw new JobConflictError('Job payload 必须是 JSON object');
  }
}
