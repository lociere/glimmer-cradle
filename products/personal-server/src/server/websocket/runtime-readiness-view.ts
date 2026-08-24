export type RuntimeReadinessState = 'starting' | 'ready' | 'degraded' | 'failed' | 'stopped';
export type RuntimeResourceState = 'pending' | 'ready' | 'missing' | 'degraded' | 'failed' | 'unknown';
export interface RuntimeReadinessCatalog {
  updated_at: number;
  runtimes: Array<{
    runtime_id: string;
    owner: 'kernel' | 'cognition' | 'engine' | 'renderer' | 'extension';
    phase: string;
    state: RuntimeReadinessState;
    blocking: boolean;
    summary: string;
    details_ref?: string;
    duration_ms?: number;
    reconciler?: {
      desired: string; actual: string; readiness: RuntimeResourceState;
      resources: Array<{
        resource_id: string; resource_kind: string; desired_state: RuntimeResourceState;
        actual_state: RuntimeResourceState; readiness: RuntimeResourceState; summary: string;
        recovery_actions: string[];
      }>;
    };
  }>;
}
