import type { Job } from './job.js';
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
