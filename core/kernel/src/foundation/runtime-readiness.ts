/**
 * Runtime readiness —— Kernel 启动期的统一就绪快照。
 *
 * 它只描述“某个运行体现在是否可用、是否阻塞主流程、给人看的摘要是什么”。
 * 具体路径、堆栈、下载细节留在 debug 日志和进程日志中，避免主启动时间线被细节淹没。
 */

export type RuntimeReadinessOwner =
  | 'kernel'
  | 'cognition'
  | 'engine'
  | 'renderer'
  | 'extension';

export type RuntimeReadinessState =
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'failed'
  | 'stopped';

export interface RuntimeReadinessSnapshot {
  readonly runtime_id: string;
  readonly owner: RuntimeReadinessOwner;
  readonly phase: string;
  readonly state: RuntimeReadinessState;
  readonly blocking: boolean;
  readonly summary: string;
  readonly details_ref?: string;
  readonly duration_ms?: number;
  readonly reconciler?: RuntimeReconcilerSnapshot;
}

export function normalizeRuntimeReadiness(input: unknown): RuntimeReadinessSnapshot[] {
  const values = Array.isArray(input) ? input : input ? [input] : [];
  return values.filter(isRuntimeReadinessSnapshot);
}

export function summarizeRuntimeReadiness(snapshots: RuntimeReadinessSnapshot[]): string | undefined {
  if (snapshots.length === 0) return undefined;
  return snapshots.map((snapshot) => (
    `${snapshot.runtime_id}:${snapshot.state}${snapshot.blocking ? ':blocking' : ''}`
  )).join(',');
}

export function strongestRuntimeReadinessState(
  snapshots: RuntimeReadinessSnapshot[],
): RuntimeReadinessState | undefined {
  if (snapshots.some((snapshot) => snapshot.state === 'failed')) return 'failed';
  if (snapshots.some((snapshot) => snapshot.state === 'degraded')) return 'degraded';
  if (snapshots.some((snapshot) => snapshot.state === 'starting')) return 'starting';
  if (snapshots.some((snapshot) => snapshot.state === 'ready')) return 'ready';
  if (snapshots.some((snapshot) => snapshot.state === 'stopped')) return 'stopped';
  return undefined;
}

function isRuntimeReadinessSnapshot(value: unknown): value is RuntimeReadinessSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.runtime_id === 'string'
    && typeof snapshot.owner === 'string'
    && typeof snapshot.phase === 'string'
    && typeof snapshot.state === 'string'
    && typeof snapshot.blocking === 'boolean'
    && typeof snapshot.summary === 'string';
}
import type { RuntimeReconcilerSnapshot } from './runtime-reconciler';
