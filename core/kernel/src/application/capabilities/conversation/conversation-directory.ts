import type { ConversationAddress, ConversationContext } from '../../../ports/application-models';
import type { StableIdentityPort } from '../../../ports/identity.port';

export interface ResolvedConversation {
  context: ConversationContext;
  actor_id?: string;
  actor_name?: string;
  source_key: string;
}

/** 将平台地址解析为稳定、不可逆且与 Cognition 无关的规范会话拓扑。 */
export class ConversationDirectory {
  public constructor(private readonly identity: StableIdentityPort) {}

  public resolve(address: ConversationAddress, interactionId: string = this.identity.newId()): ResolvedConversation {
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
        interaction_id: interactionId,
        recall_scope: scope,
        disclosure_scope: scope,
      },
      actor_id: actor ? `actor:${provider}:${actor}` : undefined,
      actor_name: address.actor_display_name ?? undefined,
      source_key: sceneId,
    };
  }

  private digest(...values: string[]): string {
    return this.identity.digest(values).slice(0, 20);
  }

  private part(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').slice(0, 48) || 'unknown';
  }
}
