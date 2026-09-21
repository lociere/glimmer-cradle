import type { StableIdentity } from '@glimmer-cradle/platform/identity';

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

/** 将外部 endpoint/thread 地址解析为稳定、不可逆的 Conversation Binding。 */
export class ConversationDirectory {
  public constructor(private readonly identity: StableIdentity) {}

  public resolve(
    address: ConversationAddress,
    interactionId: string = this.identity.newId(),
  ): ResolvedConversation {
    this.validateAddress(address);
    const resolvedInteractionId = this.required(interactionId, 'interaction_id');
    const provider = this.part(address.provider_id);
    const account = this.digest(address.provider_id, address.provider_account_id);
    const space = this.digest(address.provider_id, address.provider_account_id, address.external_space_key);
    const thread = address.external_thread_key
      ? this.digest(address.provider_id, address.external_space_key, address.external_thread_key)
      : 'main';
    const continuity = this.digest(
      address.provider_id,
      address.provider_account_id,
      address.continuity_key ?? address.actor_endpoint_key ?? 'character',
    );
    const actor = address.actor_endpoint_key
      ? this.digest(address.provider_id, address.provider_account_id, address.actor_endpoint_key)
      : undefined;
    const scope = address.visibility === 'public'
      ? 'public'
      : address.space_kind === 'group' || address.space_kind === 'channel' || address.visibility === 'shared'
        ? 'space_local'
        : 'conversation_private';
    const sceneId = `scene:${provider}:${account}:${space}`;
    const conversationId = `conversation:${provider}:${account}:${space}`;
    return {
      context: {
        source_provider_id: address.provider_id,
        scene_id: sceneId,
        conversation_id: conversationId,
        continuity_id: `continuity:${provider}:${continuity}`,
        thread_id: thread === 'main' ? 'main' : `thread:${thread}`,
        interaction_id: resolvedInteractionId,
        recall_scope: scope,
        disclosure_scope: scope,
      },
      actor_id: actor ? `actor:${provider}:${actor}` : undefined,
      actor_name: address.actor_display_name?.trim() || undefined,
      source_key: sceneId,
    };
  }

  private digest(...values: string[]): string {
    return this.identity.digest(values).slice(0, 20);
  }

  private part(value: string): string {
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').slice(0, 48);
    if (!normalized) throw new TypeError('provider_id 必须包含可用的 ASCII 标识符');
    return normalized;
  }

  private validateAddress(address: ConversationAddress): void {
    if (!address || typeof address !== 'object') {
      throw new TypeError('ConversationAddress 必须是对象');
    }
    this.required(address.provider_id, 'provider_id');
    this.required(address.provider_account_id, 'provider_account_id');
    this.required(address.external_space_key, 'external_space_key');
    const spaceKinds = new Set(['personal', 'direct', 'group', 'channel', 'thread', 'world', 'custom']);
    if (!spaceKinds.has(address.space_kind)) {
      throw new TypeError(`不支持的 space_kind: ${String(address.space_kind)}`);
    }
    const visibilities = new Set(['private', 'shared', 'public']);
    if (!visibilities.has(address.visibility)) {
      throw new TypeError(`不支持的 visibility: ${String(address.visibility)}`);
    }
    for (const [name, value] of [
      ['external_thread_key', address.external_thread_key],
      ['parent_space_key', address.parent_space_key],
      ['actor_endpoint_key', address.actor_endpoint_key],
      ['continuity_key', address.continuity_key],
    ] as const) {
      if (value !== undefined && value !== null) this.required(value, name);
    }
  }

  private required(value: unknown, name: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TypeError(`${name} 不得为空`);
    }
    return value.trim();
  }
}
