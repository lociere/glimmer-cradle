/* 自动生成 — 从 ConversationContext.schema.json 生成，勿手动修改 */

/**
 * Kernel 已解析的规范会话上下文；Cognition 只消费此结构，不解释平台地址。
 */
export interface ConversationContext {
  /**
   * 产生当前会话的稳定 Provider ID；用于 Kernel 路由和能力作用域，不包含外部账号或联系人标识。
   */
  source_provider_id: string;
  scene_id: string;
  conversation_id: string;
  continuity_id: string;
  thread_id: string;
  interaction_id: string;
  recall_scope:
    | 'conversation_private'
    | 'actor_private'
    | 'space_local'
    | 'character_internal'
    | 'global_safe'
    | 'public';
  disclosure_scope: 'conversation_private' | 'actor_private' | 'space_local' | 'global_safe' | 'public';
}
