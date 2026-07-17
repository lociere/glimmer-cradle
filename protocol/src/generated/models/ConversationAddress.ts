/* 自动生成 — 从 ConversationAddress.schema.json 生成，勿手动修改 */

/**
 * 外部表面或扩展提交给 Kernel Conversation Directory 的平台中立地址。外部键只停留在 Kernel 边界。
 */
export interface ConversationAddress {
  provider_id: string;
  provider_account_id: string;
  space_kind: 'personal' | 'direct' | 'group' | 'channel' | 'thread' | 'world' | 'custom';
  external_space_key: string;
  external_thread_key?: string | null;
  parent_space_key?: string | null;
  actor_endpoint_key?: string | null;
  actor_display_name?: string | null;
  continuity_key?: string | null;
  visibility: 'private' | 'shared' | 'public';
}
