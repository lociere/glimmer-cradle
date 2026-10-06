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

/** 保留原执行身份；Job 当前 epoch/token 在失效后不再代表这个 attempt。 */
export interface JobAttempt {
  readonly job_id: string;
  readonly attempt: number;
  readonly authority_epoch: number;
  readonly fencing_token: number;
  readonly owner_id: string;
  readonly started_at: number;
  readonly lease_until: number;
  readonly finished_at: number | null;
  readonly status: Exclude<JobStatus, 'queued'>;
  readonly error_code: string | null;
}

/** 私有 App 投递边界；不包含请求 payload，不作为跨进程 wire DTO。 */
export type JobStateEvent = Pick<Job, 'job_id' | 'scope_id' | 'goal_id' | 'kind' | 'revision' | 'status'
  | 'attempt' | 'authority_epoch' | 'fencing_token' | 'result' | 'error_code' | 'updated_at'> & {
    readonly event_id: string;
  };

type JobEvidenceIdentity = Pick<JobAttempt, 'job_id' | 'attempt' | 'authority_epoch' | 'fencing_token' | 'owner_id'> & {
  readonly scope_id: string;
  readonly evidence_id: string;
  readonly source_id: string;
  readonly observed_at: number;
};

export type JobReconciliationEvidence = JobEvidenceIdentity & (
  | { readonly resolution: 'applied'; readonly result: Readonly<Record<string, unknown>> }
  // 接收 owner 已拒绝原 attempt 的后续提交，并在同一权威边界确认未产生副作用。
  // 查询暂时为空、租约过期或本地 AbortSignal 均不构成此证明。
  | { readonly resolution: 'not_applied'; readonly receiver_fenced: true }
  | { readonly resolution: 'failed'; readonly error_code: string }
);

export interface JobReconciliationReceipt {
  readonly status: 'accepted' | 'duplicate' | 'stale' | 'unavailable';
  readonly job: Job | null;
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
