/* 自动生成 — 从 ConversationHistoryEntry.schema.json 生成，勿手动修改 */

export interface ConversationHistoryEntry {
  entry_id: string;
  source_kind: 'conversation' | 'notice' | 'transient';
  role: 'user' | 'assistant' | 'system';
  status: 'committed' | 'pending' | 'thinking' | 'failed' | 'notice';
  text: string;
  title?: string;
  /**
   * ISO 8601 UTC 时间戳。历史时间线统一按 occurred_at 升序展示。
   */
  occurred_at: string;
  trace_id?: string;
  interaction_id?: string;
  moment_id?: string;
  /**
   * Conversation 投影中的稳定位置，仅对已提交消息存在。
   */
  position?: number;
  conversation_id: string;
  scene_id: string;
  thread_id: string;
  actor_id?: string;
  actor_name?: string;
  recall_scope: string;
  disclosure_scope: string;
}
