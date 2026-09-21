export type RecallScope =
  | 'conversation_private'
  | 'actor_private'
  | 'space_local'
  | 'character_internal'
  | 'global_safe'
  | 'public';

export type DisclosureScope = Exclude<RecallScope, 'character_internal'>;

/** 平台 Adapter 提交的 opaque 会话地址；外部键不得越过 Binding owner。 */
export interface ConversationAddress {
  readonly provider_id: string;
  readonly provider_account_id: string;
  readonly space_kind: 'personal' | 'direct' | 'group' | 'channel' | 'thread' | 'world' | 'custom';
  readonly external_space_key: string;
  readonly external_thread_key?: string | null;
  readonly parent_space_key?: string | null;
  readonly actor_endpoint_key?: string | null;
  readonly actor_display_name?: string | null;
  readonly continuity_key?: string | null;
  readonly visibility: 'private' | 'shared' | 'public';
}

/** Conversation owner 对下游暴露的稳定上下文，不包含平台原始标识。 */
export interface ConversationContext {
  readonly source_provider_id: string;
  readonly scene_id: string;
  readonly conversation_id: string;
  readonly continuity_id: string;
  readonly thread_id: string;
  readonly interaction_id: string;
  readonly recall_scope: RecallScope;
  readonly disclosure_scope: DisclosureScope;
}

export interface ResolvedConversation {
  readonly context: ConversationContext;
  readonly actor_id?: string;
  readonly actor_name?: string;
  readonly source_key: string;
}

/** 持久 Binding 不保存外部原始键；interaction identity 每次解析时单独生成。 */
export interface ConversationBinding {
  readonly binding_key: string;
  readonly source_provider_id: string;
  readonly scene_id: string;
  readonly conversation_id: string;
  readonly continuity_id: string;
  readonly thread_id: string;
  readonly recall_scope: RecallScope;
  readonly disclosure_scope: DisclosureScope;
  readonly actor_id?: string;
  readonly created_at: string;
}

