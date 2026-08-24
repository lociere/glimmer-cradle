export interface ObservabilityEvent {
  timestamp: string; level: 'debug' | 'info' | 'warn' | 'error'; event_type: string;
  event_action: string | null; event_outcome: string | null; event_reason: string | null;
  owner: string; module: string; runtime_id: string; phase: string | null; trace_id: string;
  span_id: string | null; parent_span_id: string | null; scene_id: string | null;
  extension_id: string | null; provider_id: string | null; skill_id: string | null;
  tool_name: string | null; process_id: string | null; error_code: string | null;
  error_kind: string | null; diagnostic_hint: string | null; artifact_ref: string | null;
  details_ref: string | null; duration_ms: number | null; schema_version: string;
  attributes: Record<string, unknown>;
}
export interface AuditRecord {
  timestamp: string; action: string; target_kind: string; target_name: string | null;
  actor_kind: string | null; actor_id: string | null; owner: string; module: string | null;
  runtime_id: string; trace_id: string; span_id: string | null; scene_id: string | null;
  extension_id: string | null; provider_id: string | null; skill_id: string | null;
  tool_name: string | null; risk_level: string | null; outcome: string; reason: string | null;
  diagnostic_hint: string | null; artifact_ref: string | null; details_ref: string | null;
  duration_ms: number | null; schema_version: string; attributes: Record<string, unknown>;
}
export interface ModelInvocationRecord {
  timestamp: string; invocation_id: string; capture_mode: 'off' | 'summary' | 'full'; purpose: string;
  capture_category: 'decision' | 'skill' | 'response' | 'memory' | 'other'; owner: string;
  module: string | null; runtime_id: string; trace_id: string; span_id: string | null;
  scene_id: string | null; provider_id: string; model_id: string; outcome: string;
  duration_ms: number | null; prompt_chars: number | null; response_chars: number | null;
  prompt_hash: string | null; response_hash: string | null; provider_payload_ref: string | null;
  raw_response_ref: string | null; prompt_text_ref: string | null; response_text_ref: string | null;
  normalized_text_ref: string | null; error_code: string | null; error_summary: string | null;
  redacted: boolean; schema_version: string; attributes: Record<string, unknown>;
}
export interface ObservabilityConfig {
  console_format: 'pretty' | 'json'; file_format: 'json'; level: 'debug' | 'info' | 'warn' | 'error';
  module_levels: Record<string, 'debug' | 'info' | 'warn' | 'error'> | null;
  rotation: { main_size_mb: number; main_keep: number; error_size_mb: number; error_keep: number };
  model_invocations: { capture_mode: 'off' | 'summary' | 'full'; full_retention_days: number; redact_secrets: boolean };
  retention: { events_days: number; traces_days: number; metrics_days: number; audit_days: number; model_invocation_days: number; application_log_days: number; dlq_days: number; bundles_days: number };
  index: { mode: 'sqlite' | 'jsonl_scan'; db_path: string };
  bundles: { export_dir: string; process_tail_bytes: number; include_model_invocation_captures: boolean };
}
