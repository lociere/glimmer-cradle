/* 自动生成 — 从 MemoryConfig.schema.json 生成，勿手动修改 */

/**
 * 经历、Episode、记忆固化、时间记忆与有界召回的统一配置。
 */
export interface MemoryConfig {
  working: WorkingMemoryConfig;
  conversation: ConversationProjectionConfig;
  experience: ExperienceLedgerConfig;
  consolidation: ConsolidationConfig;
  retrieval: RetrievalConfig;
}
export interface WorkingMemoryConfig {
  max_messages_per_conversation: number;
  hydrate_recent_messages: number;
  context_message_limit: number;
}
export interface ConversationProjectionConfig {
  segment_target_messages: number;
  chapter_idle_minutes: number;
  chapter_segment_limit: number;
  state_update_messages: number;
  history_candidate_limit: number;
  history_result_limit: number;
  summary_max_chars: number;
}
export interface ExperienceLedgerConfig {
  enabled: boolean;
  pack_max_size_mb: number;
  flush_interval_ms: number;
  flush_max_buffer: number;
  episode_idle_seconds: number;
  seal_integrity_check: boolean;
}
export interface ConsolidationConfig {
  enabled: boolean;
  batch_size: number;
  max_batch_moments: number;
  debounce_seconds: number;
  max_wait_seconds: number;
  lease_seconds: number;
  retry_base_seconds: number;
  minimum_salience: number;
  autobiographical_evidence_threshold: number;
  schedule_interval_seconds: number;
}
export interface RetrievalConfig {
  token_budget: number;
  candidate_limit: number;
  result_limit: number;
  semantic_weight: number;
}
