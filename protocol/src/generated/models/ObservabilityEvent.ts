/* 自动生成 — 从 ObservabilityEvent.schema.json 生成，勿手动修改 */

/**
 * Glimmer Local Observability Plane 统一结构化事件模型。
 */
export interface ObservabilityEvent {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  event_type: string;
  event_action: string | null;
  event_outcome:
    | 'started'
    | 'succeeded'
    | 'failed'
    | 'partial'
    | 'skipped'
    | 'policy_denied'
    | 'timeout'
    | 'cancelled'
    | 'queued'
    | 'replayed'
    | null;
  event_reason: string | null;
  owner: string;
  module: string;
  runtime_id: string;
  phase: string | null;
  trace_id: string;
  span_id: string | null;
  parent_span_id: string | null;
  scene_id: string | null;
  extension_id: string | null;
  provider_id: string | null;
  skill_id: string | null;
  tool_name: string | null;
  process_id: string | null;
  error_code: string | null;
  error_kind: string | null;
  diagnostic_hint: string | null;
  artifact_ref: string | null;
  details_ref: string | null;
  duration_ms: number | null;
  schema_version: string;
  attributes: {
    [k: string]: unknown;
  };
}
