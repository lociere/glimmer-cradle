/* 自动生成 — 从 ConversationHistoryPayload.schema.json 生成，勿手动修改 */

/**
 * Kernel 向 Cognition 请求 Conversation 投影历史页的 IPC 载荷。allowed_scopes 由 Kernel 依据当前产品上下文注入，浏览器不直接声明。
 */
export interface ConversationHistoryPayload {
  request_id: string;
  conversation_id: string;
  scene_id: string;
  thread_id: string;
  actor_id?: string;
  actor_name?: string;
  source_provider_id: string;
  cursor?: string;
  limit: number;
  /**
   * @minItems 1
   */
  allowed_scopes: [string, ...string[]];
}
