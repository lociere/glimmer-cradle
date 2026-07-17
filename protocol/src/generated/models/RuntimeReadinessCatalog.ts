/* 自动生成 — 从 RuntimeReadinessCatalog.schema.json 生成，勿手动修改 */

export type RuntimeReadinessOwner = 'kernel' | 'cognition' | 'engine' | 'renderer' | 'extension';
export type RuntimeReadinessState = 'starting' | 'ready' | 'degraded' | 'failed' | 'stopped';
export type RuntimeResourceState = 'pending' | 'ready' | 'missing' | 'degraded' | 'failed' | 'unknown';

/**
 * Kernel 向 Desktop 等跨进程消费者广播的统一 runtime readiness / reconciler 快照目录。
 */
export interface RuntimeReadinessCatalog {
  /**
   * Unix 毫秒时间戳。
   */
  updated_at: number;
  runtimes: RuntimeReadinessSnapshot[];
}
export interface RuntimeReadinessSnapshot {
  runtime_id: string;
  owner: RuntimeReadinessOwner;
  phase: string;
  state: RuntimeReadinessState;
  blocking: boolean;
  summary: string;
  details_ref?: string;
  duration_ms?: number;
  reconciler?: RuntimeReconcilerSnapshot;
}
export interface RuntimeReconcilerSnapshot {
  desired: string;
  actual: string;
  readiness: RuntimeResourceState;
  resources: RuntimeResourceSnapshot[];
}
export interface RuntimeResourceSnapshot {
  resource_id: string;
  resource_kind: string;
  desired_state: RuntimeResourceState;
  actual_state: RuntimeResourceState;
  readiness: RuntimeResourceState;
  summary: string;
  recovery_actions: string[];
}
