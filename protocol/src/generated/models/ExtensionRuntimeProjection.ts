/* 自动生成 — 从 ExtensionRuntimeProjection.schema.json 生成，勿手动修改 */

export type LifecycleState =
  | 'discovered'
  | 'loaded'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'degraded'
  | 'failed';
export type CapabilityNodeState =
  | 'declared'
  | 'preparing'
  | 'starting'
  | 'live'
  | 'ready'
  | 'available'
  | 'unavailable'
  | 'degraded'
  | 'failed'
  | 'stopped'
  | 'disabled'
  | 'unsupported';
export type ActionIntentState = 'enabled' | 'disabled' | 'hidden' | 'unsupported';
export type DiagnosticSeverity = 'info' | 'warning' | 'error';

/**
 * Extension Host 发布给 Desktop 和其他跨进程消费者的扩展运行投影。Host 是唯一生产者，Renderer 只消费该投影。运行事实以 Capability Graph 表达，具体能力类型由 Contribution Point Registry 定义。
 */
export interface ExtensionRuntimeProjection {
  schema: 'glimmer-cradle.extension.runtime-projection';
  extension_id: string;
  display_name?: string;
  version?: string;
  description?: string;
  permissions: string[];
  tags: string[];
  lifecycle: LifecycleState;
  summary?: string;
  contribution_points: ContributionPointDefinitionSnapshot[];
  capability_graph: CapabilityGraphSnapshot;
  actions: ActionIntentSnapshot[];
  diagnostics: DiagnosticsSnapshot;
  updated_at: string;
}
export interface ContributionPointDefinitionSnapshot {
  id: string;
  title: string;
  description?: string;
  owner: 'platform' | 'extension' | 'third_party';
  state: 'registered' | 'unsupported' | 'disabled';
  node_kind?: string;
  action_kind?: string;
  required_permissions: string[];
  metadata: {
    [k: string]: unknown;
  };
}
export interface CapabilityGraphSnapshot {
  nodes: CapabilityGraphNode[];
  edges: CapabilityGraphEdge[];
}
export interface CapabilityGraphNode {
  id: string;
  contribution_point: string;
  kind: string;
  title: string;
  description?: string;
  state: CapabilityNodeState;
  owner: 'platform' | 'extension' | 'third_party';
  owner_id?: string;
  /**
   * 能力暴露对象。只有 character 可以进入人物可用 Skill catalog；user 用于管理 UI；host/adapter/renderer/extension 不可被人物直接调用。
   */
  audience: 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter';
  required: boolean;
  summary: string;
  permissions: string[];
  readiness_gates: ReadinessGateSnapshot[];
  diagnostic_refs: string[];
  metadata: {
    [k: string]: unknown;
  };
  updated_at: string;
}
export interface ReadinessGateSnapshot {
  id: string;
  kind: string;
  state: CapabilityNodeState;
  summary: string;
  endpoint?: string;
  checked_at: string;
  latency_ms?: number;
  error_code?: string;
  error_message?: string;
}
export interface CapabilityGraphEdge {
  from: string;
  to: string;
  relation: string;
  required_state?: string;
  summary?: string;
}
export interface ActionIntentSnapshot {
  id: string;
  label: string;
  contribution_point: string;
  action_kind: string;
  target_node_id: string;
  /**
   * 动作入口暴露对象。Control Center 只消费 user audience；character 不通过 action intent 触发。
   */
  audience: 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter';
  state: ActionIntentState;
  disabled_reason?: string;
  permissions: string[];
  confirmation_required: boolean;
  metadata: {
    [k: string]: unknown;
  };
}
export interface DiagnosticsSnapshot {
  summary: string;
  last_error?: string;
  trace_id?: string;
  entries: DiagnosticsEntry[];
  log_locations: string[];
  recovery_actions: string[];
}
export interface DiagnosticsEntry {
  id: string;
  severity: DiagnosticSeverity;
  summary: string;
  node_id?: string;
  trace_id?: string;
  log_locations: string[];
  recovery_actions: string[];
  metadata: {
    [k: string]: unknown;
  };
}
