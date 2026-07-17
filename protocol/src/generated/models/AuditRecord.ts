/* 自动生成 — 从 AuditRecord.schema.json 生成，勿手动修改 */

/**
 * 高风险副作用动作的独立审计记录。
 */
export interface AuditRecord {
  timestamp: string;
  action: string;
  target_kind: string;
  target_name: string | null;
  actor_kind: string | null;
  actor_id: string | null;
  owner: string;
  module: string | null;
  runtime_id: string;
  trace_id: string;
  span_id: string | null;
  scene_id: string | null;
  extension_id: string | null;
  provider_id: string | null;
  skill_id: string | null;
  tool_name: string | null;
  risk_level: string | null;
  outcome:
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
  reason: string | null;
  diagnostic_hint: string | null;
  artifact_ref: string | null;
  details_ref: string | null;
  duration_ms: number | null;
  schema_version: string;
  attributes: {
    [k: string]: unknown;
  };
}
