import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConversationDirectory,
  SqliteBindingStore,
  assertConversationMessage,
  type ConversationAddress,
} from '../src/index.js';

const identity = {
  newId: () => 'interaction-default',
  digest: (parts: readonly string[]) => parts.join('|').split('').reduce(
    (value, character) => `${value}${character.charCodeAt(0).toString(16)}`,
    '',
  ).padEnd(20, '0'),
};

const address: ConversationAddress = {
  provider_id: 'provider',
  provider_account_id: 'secret-account-123',
  space_kind: 'direct',
  external_space_key: 'secret-space-456',
  actor_endpoint_key: 'secret-actor-789',
  visibility: 'private',
};

describe('Conversation public API', () => {
  it('解析稳定 opaque binding 并拒绝权限分类漂移', () => {
    const root = mkdtempSync(join(tmpdir(), 'glimmer-conversation-binding-'));
    const databasePath = join(root, 'bindings.db');
    try {
      const firstStore = new SqliteBindingStore(databasePath);
      const firstDirectory = new ConversationDirectory(
        identity, firstStore, { nowIso: () => '2026-01-01T00:00:00Z' },
      );
      const first = firstDirectory.resolve(address, 'interaction-first');
      firstStore.close();

      const secondStore = new SqliteBindingStore(databasePath);
      const secondDirectory = new ConversationDirectory(
        identity, secondStore, { nowIso: () => '2026-01-02T00:00:00Z' },
      );
      const second = secondDirectory.resolve(address, 'interaction-second');
      expect(() => secondDirectory.resolve(
        { ...address, visibility: 'shared' }, 'interaction-drift',
      )).toThrow(/Binding 冲突/u);
      secondStore.close();

      expect(second.context.conversation_id).toBe(first.context.conversation_id);
      expect(second.context.thread_id).toBe(first.context.thread_id);
      expect(readFileSync(databasePath).toString('utf8')).not.toMatch(
        /secret-account-123|secret-space-456|secret-actor-789/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('公开 Message 拒绝空身份和空内容', () => {
    const base = {
      message_id: 'message:1',
      conversation_id: 'conversation:1',
      thread_id: 'main',
      interaction_id: 'interaction:1',
      participant: { participant_id: 'actor:1', role: 'user' as const },
      occurred_at: '2026-09-22T00:00:00Z',
    };
    expect(() => assertConversationMessage({ ...base, content: [] })).toThrow(/ContentPart/u);
    expect(() => assertConversationMessage({
      ...base,
      message_id: ' ',
      content: [{ kind: 'text', text: '你好' }],
    })).toThrow(/message_id/u);
    expect(() => assertConversationMessage({
      ...base,
      participant: { participant_id: ' ', role: 'user' },
      content: [{ kind: 'text', text: '你好' }],
    })).toThrow(/participant_id/u);
  });
});
