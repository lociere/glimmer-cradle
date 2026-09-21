import type { StableIdentity } from '@glimmer-cradle/platform/identity';
import type { BindingStorePort } from './binding-store-port.js';
import type {
  ConversationAddress,
  ConversationBinding,
  DisclosureScope,
  RecallScope,
  ResolvedConversation,
} from './binding.js';

export interface BindingClock {
  nowIso(): string;
}

const SYSTEM_BINDING_CLOCK: BindingClock = {
  nowIso: () => new Date().toISOString(),
};

/** 将外部 endpoint/thread 地址解析为稳定、不可逆的 Conversation Binding。 */
export class ConversationDirectory {
  public constructor(
    private readonly identity: StableIdentity,
    private readonly store?: BindingStorePort,
    private readonly clock: BindingClock = SYSTEM_BINDING_CLOCK,
  ) {}

  public resolve(
    address: ConversationAddress,
    interactionId: string = this.identity.newId(),
  ): ResolvedConversation {
    this.validateAddress(address);
    const resolvedInteractionId = this.required(interactionId, 'interaction_id');
    const bindingKey = this.digest(
      address.provider_id,
      address.provider_account_id,
      address.external_space_key,
      address.external_thread_key ?? '',
      address.actor_endpoint_key ?? '',
      address.continuity_key ?? '',
    );
    const proposed = this.createBinding(bindingKey, address);
    const binding = this.store
      ? this.store.load(bindingKey) ?? this.store.create(proposed)
      : proposed;
    this.ensureBindingMatches(binding, proposed);
    return {
      context: {
        source_provider_id: binding.source_provider_id,
        scene_id: binding.scene_id,
        conversation_id: binding.conversation_id,
        continuity_id: binding.continuity_id,
        thread_id: binding.thread_id,
        interaction_id: resolvedInteractionId,
        recall_scope: binding.recall_scope,
        disclosure_scope: binding.disclosure_scope,
      },
      ...(binding.actor_id ? { actor_id: binding.actor_id } : {}),
      actor_name: address.actor_display_name?.trim() || undefined,
      source_key: binding.scene_id,
    };
  }

  private createBinding(bindingKey: string, address: ConversationAddress): ConversationBinding {
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
    const scope: RecallScope & DisclosureScope = address.visibility === 'public'
      ? 'public'
      : address.space_kind === 'group' || address.space_kind === 'channel' || address.visibility === 'shared'
        ? 'space_local'
        : 'conversation_private';
    const sceneId = `scene:${provider}:${account}:${space}`;
    return {
      binding_key: bindingKey,
      source_provider_id: address.provider_id,
      scene_id: sceneId,
      conversation_id: `conversation:${provider}:${account}:${space}`,
      continuity_id: `continuity:${provider}:${continuity}`,
      thread_id: thread === 'main' ? 'main' : `thread:${thread}`,
      recall_scope: scope,
      disclosure_scope: scope,
      ...(actor ? { actor_id: `actor:${provider}:${actor}` } : {}),
      created_at: this.clock.nowIso(),
    };
  }

  private ensureBindingMatches(persisted: ConversationBinding, proposed: ConversationBinding): void {
    for (const key of [
      'binding_key', 'source_provider_id', 'scene_id', 'conversation_id',
      'continuity_id', 'thread_id', 'recall_scope', 'disclosure_scope', 'actor_id',
    ] as const) {
      if (persisted[key] !== proposed[key]) {
        throw new Error(`Conversation Binding 冲突: ${proposed.binding_key}`);
      }
    }
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
