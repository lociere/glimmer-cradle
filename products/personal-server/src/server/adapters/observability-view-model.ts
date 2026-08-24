export interface ObservabilityEvent {
  timestamp: string; level: 'debug' | 'info' | 'warn' | 'error'; event_type: string;
  owner: string; module: string; trace_id: string; runtime_id: string; attributes: Record<string, unknown>;
  event_action?: string | null; event_outcome?: string | null; event_reason?: string | null;
  diagnostic_hint?: string | null; error_code?: string | null;
}
export interface AuditRecord {
  timestamp: string; action: string; owner: string; runtime_id: string; trace_id: string;
  outcome: string; attributes: Record<string, unknown>; module?: string | null;
  target_kind: string; target_name: string | null; reason: string | null;
}
