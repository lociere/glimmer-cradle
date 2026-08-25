export type LifecycleState = 'discovered' | 'loaded' | 'starting' | 'running' | 'stopping' | 'stopped' | 'degraded' | 'failed';
export type CapabilityNodeState = 'declared' | 'preparing' | 'starting' | 'live' | 'ready' | 'available' | 'unavailable' | 'degraded' | 'failed' | 'stopped' | 'disabled' | 'unsupported';
export type ActionIntentState = 'enabled' | 'disabled' | 'hidden' | 'unsupported';
export type DiagnosticSeverity = 'info' | 'warning' | 'error';

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

export interface ContributionPointDefinitionSnapshot { id: string; title: string; description?: string; owner: 'platform' | 'extension' | 'third_party'; state: 'registered' | 'unsupported' | 'disabled'; node_kind?: string; action_kind?: string; required_permissions: string[]; metadata: Record<string, unknown>; }
export interface CapabilityGraphSnapshot { nodes: CapabilityGraphNode[]; edges: CapabilityGraphEdge[]; }
export interface CapabilityGraphNode { id: string; contribution_point: string; kind: string; title: string; description?: string; state: CapabilityNodeState; owner: 'platform' | 'extension' | 'third_party'; owner_id?: string; audience: 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter'; required: boolean; summary: string; permissions: string[]; readiness_gates: ReadinessGateSnapshot[]; diagnostic_refs: string[]; metadata: Record<string, unknown>; updated_at: string; }
export interface ReadinessGateSnapshot { id: string; kind: string; state: CapabilityNodeState; summary: string; endpoint?: string; checked_at: string; latency_ms?: number; error_code?: string; error_message?: string; }
export interface CapabilityGraphEdge { from: string; to: string; relation: string; required_state?: string; summary?: string; }
export interface ActionIntentSnapshot { id: string; label: string; contribution_point: string; action_kind: string; target_node_id: string; audience: 'character' | 'user' | 'host' | 'renderer' | 'extension' | 'adapter'; state: ActionIntentState; disabled_reason?: string; permissions: string[]; confirmation_required: boolean; metadata: Record<string, unknown>; }
export interface DiagnosticsSnapshot { summary: string; last_error?: string; trace_id?: string; entries: DiagnosticsEntry[]; log_locations: string[]; recovery_actions: string[]; }
export interface DiagnosticsEntry { id: string; severity: DiagnosticSeverity; summary: string; node_id?: string; trace_id?: string; log_locations: string[]; recovery_actions: string[]; metadata: Record<string, unknown>; }

export interface ExtensionInstallationProjection {
  extension_id: string;
  installed_versions: [string, ...string[]];
  active_version?: string;
  active_profile?: string;
  updated_at: string;
}
