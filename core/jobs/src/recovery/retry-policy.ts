export interface RetryPolicy { readonly base_delay_ms: number; readonly max_delay_ms: number; }

export function retryDelay(attempt: number, policy: RetryPolicy): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1
    || !Number.isSafeInteger(policy.base_delay_ms) || policy.base_delay_ms < 1
    || !Number.isSafeInteger(policy.max_delay_ms) || policy.max_delay_ms < policy.base_delay_ms) {
    throw new Error('Job backoff policy 无效');
  }
  return Math.min(policy.max_delay_ms, policy.base_delay_ms * 2 ** Math.min(attempt - 1, 30));
}
