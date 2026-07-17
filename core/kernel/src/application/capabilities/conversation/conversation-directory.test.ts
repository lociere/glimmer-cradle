import { describe, expect, it } from 'vitest';
import { ConversationDirectory } from './conversation-directory';

describe('ConversationDirectory', () => {
  it('为同一平台地址生成稳定且不暴露外部键的会话拓扑', () => {
    const address = {
      provider_id: 'lociere.napcat-adapter',
      provider_account_id: '123456789',
      space_kind: 'direct' as const,
      external_space_key: '987654321',
      actor_endpoint_key: '987654321',
      visibility: 'private' as const,
    };

    const first = ConversationDirectory.instance.resolve(address, 'interaction-a');
    const second = ConversationDirectory.instance.resolve(address, 'interaction-b');

    expect(second.context.conversation_id).toBe(first.context.conversation_id);
    expect(second.context.continuity_id).toBe(first.context.continuity_id);
    expect(second.context.interaction_id).toBe('interaction-b');
    expect(first.context.recall_scope).toBe('conversation_private');
    expect(JSON.stringify(first)).not.toContain('123456789');
    expect(JSON.stringify(first)).not.toContain('987654321');
  });

  it('按空间可见性生成受限召回作用域', () => {
    const shared = ConversationDirectory.instance.resolve({
      provider_id: 'community.example-extension',
      provider_account_id: 'account',
      space_kind: 'group',
      external_space_key: 'group',
      visibility: 'shared',
    });
    const publicContext = ConversationDirectory.instance.resolve({
      provider_id: 'community.example-extension',
      provider_account_id: 'account',
      space_kind: 'channel',
      external_space_key: 'public-channel',
      visibility: 'public',
    });

    expect(shared.context.recall_scope).toBe('space_local');
    expect(publicContext.context.recall_scope).toBe('public');
  });
});
