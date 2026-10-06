import type { Job, JobAttempt, JobReconciliationEvidence, JobStateEvent } from './job.js';
import type { JobLease } from '../scheduling/job-lease.js';

export interface JobExecutionContext {
  readonly job: Job;
  readonly lease: JobLease;
  readonly signal: AbortSignal;
  /** 这是当前租约检查；跨库副作用仍须由接收 owner 在提交点验证 fencing。 */
  assertLease(): void;
  renew(leaseMs: number): void;
}

export type JobHandlerResult =
  | { readonly status: 'succeeded'; readonly result: Readonly<Record<string, unknown>> }
  | { readonly status: 'failed'; readonly error_code: string; readonly retryable: boolean; readonly effects: 'none' | 'unknown' };

/** handler 注册归 App；Core Jobs 不导入 Cognition、Capability 或平台业务实现。 */
export interface JobHandlerPort {
  readonly kind: string;
  readonly retry_mode: Job['retry_mode'];
  execute(context: JobExecutionContext, payload: Job['payload']): Promise<JobHandlerResult>;
}

/** App 注入可信结果查询；必须核验接收 owner 的持久 receipt，不接受模型自报结果。 */
export interface JobReconciliationPort {
  readonly kind: string;
  query(job: Job, attempt: JobAttempt, signal?: AbortSignal): Promise<JobReconciliationEvidence | null>;
}

/** 接收 owner 在同一事务中应用业务变化与 event_id inbox 后返回持久确认。 */
export interface JobStateReceiverPort {
  accept(event: JobStateEvent, signal?: AbortSignal): Promise<{ readonly event_id: string; readonly accepted: true }>;
}
