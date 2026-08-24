/* Kernel Observability Adapter owner-local projection。 */

/** 结构化可观测性事件结果枚举。 */
export type EventOutcome =
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'partial'
  | 'skipped'
  | 'policy_denied'
  | 'timeout'
  | 'cancelled'
  | 'queued'
  | 'replayed';

/** EventOutcome 值访问对象（EventOutcome.XXX）。 */
export const EventOutcome = {
  STARTED: 'started',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  PARTIAL: 'partial',
  SKIPPED: 'skipped',
  POLICY_DENIED: 'policy_denied',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled',
  QUEUED: 'queued',
  REPLAYED: 'replayed',
} as const satisfies Record<string, EventOutcome>;
