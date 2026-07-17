/* 自动生成 — 从 ModelInvocationRecord.schema.json 生成，勿手动修改 */

/**
 * 模型调用观测记录；默认只保留摘要，完整 prompt/response 仅在 full 模式进入受控 capture。
 */
export interface ModelInvocationRecord {
  timestamp: string;
  invocation_id: string;
  capture_mode: 'off' | 'summary' | 'full';
  purpose: string;
  /**
   * 模型调用的语义分类；full 模式据此分类 capture，summary 模式据此支持诊断筛选。
   */
  capture_category: 'decision' | 'skill' | 'response' | 'memory' | 'other';
  owner: string;
  module: string | null;
  runtime_id: string;
  trace_id: string;
  span_id: string | null;
  scene_id: string | null;
  provider_id: string;
  model_id: string;
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
  duration_ms: number | null;
  prompt_chars: number | null;
  response_chars: number | null;
  prompt_hash: string | null;
  response_hash: string | null;
  provider_payload_ref: string | null;
  raw_response_ref: string | null;
  prompt_text_ref: string | null;
  response_text_ref: string | null;
  normalized_text_ref: string | null;
  error_code: string | null;
  error_summary: string | null;
  redacted: boolean;
  schema_version: string;
  attributes: {
    [k: string]: unknown;
  };
}
