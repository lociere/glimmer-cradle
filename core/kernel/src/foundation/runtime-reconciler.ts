export type RuntimeResourceState =
  | 'pending'
  | 'ready'
  | 'missing'
  | 'degraded'
  | 'failed'
  | 'unknown';

export interface RuntimeResourceSnapshot {
  readonly resource_id: string;
  readonly resource_kind: string;
  readonly desired_state: RuntimeResourceState;
  readonly actual_state: RuntimeResourceState;
  readonly readiness: RuntimeResourceState;
  readonly summary: string;
  readonly recovery_actions?: readonly string[];
}

export interface RuntimeReconcilerSnapshot {
  readonly desired: string;
  readonly actual: string;
  readonly readiness: RuntimeResourceState;
  readonly resources: readonly RuntimeResourceSnapshot[];
}

export function strongestRuntimeResourceState(
  resources: readonly RuntimeResourceSnapshot[],
): RuntimeResourceState {
  if (resources.some((item) => item.readiness === 'failed')) return 'failed';
  if (resources.some((item) => item.readiness === 'missing')) return 'missing';
  if (resources.some((item) => item.readiness === 'degraded')) return 'degraded';
  if (resources.some((item) => item.readiness === 'pending')) return 'pending';
  if (resources.every((item) => item.readiness === 'ready')) return 'ready';
  return 'unknown';
}
