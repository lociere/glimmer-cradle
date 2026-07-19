/* 自动生成 — 从 ConversationHistoryRequest.schema.json 生成，勿手动修改 */

export interface ConversationHistoryRequest {
  request_id: string;
  conversation_id?: string;
  scene_id?: string;
  thread_id?: string;
  actor_id?: string;
  source_provider_id?: string;
  /**
   * 不透明分页游标。缺省时返回最新一页。
   */
  cursor?: string;
  limit: number;
}
