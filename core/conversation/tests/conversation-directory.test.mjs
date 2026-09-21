import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationDirectory } from '../dist/index.js';

const directory = new ConversationDirectory({
  newId: () => 'interaction-default',
  digest: (parts) => parts.join('|').split('').reduce(
    (value, character) => `${value}${character.charCodeAt(0).toString(16)}`,
    '',
  ).padEnd(20, '0'),
});

test('同一平台地址生成稳定且不暴露外部键的会话拓扑', () => {
  const address = {
    provider_id: 'lociere.napcat-adapter',
    provider_account_id: '123456789',
    space_kind: 'direct',
    external_space_key: '987654321',
    actor_endpoint_key: '987654321',
    visibility: 'private',
  };

  const first = directory.resolve(address, 'interaction-a');
  const second = directory.resolve(address, 'interaction-b');

  assert.equal(second.context.conversation_id, first.context.conversation_id);
  assert.equal(second.context.continuity_id, first.context.continuity_id);
  assert.equal(second.context.interaction_id, 'interaction-b');
  assert.equal(first.context.recall_scope, 'conversation_private');
  assert.doesNotMatch(JSON.stringify(first), /123456789|987654321/u);
});

test('空间可见性映射为受限召回作用域', () => {
  const shared = directory.resolve({
    provider_id: 'community.example-extension',
    provider_account_id: 'account',
    space_kind: 'group',
    external_space_key: 'group',
    visibility: 'shared',
  });
  const publicContext = directory.resolve({
    provider_id: 'community.example-extension',
    provider_account_id: 'account',
    space_kind: 'channel',
    external_space_key: 'public-channel',
    visibility: 'public',
  });

  assert.equal(shared.context.recall_scope, 'space_local');
  assert.equal(publicContext.context.recall_scope, 'public');
});

test('默认 interaction id 来自 Platform identity，thread 与 actor 仍为 opaque id', () => {
  const resolved = directory.resolve({
    provider_id: 'provider',
    provider_account_id: 'account',
    space_kind: 'thread',
    external_space_key: 'space',
    external_thread_key: 'external-thread',
    actor_endpoint_key: 'external-actor',
    visibility: 'shared',
  });

  assert.equal(resolved.context.interaction_id, 'interaction-default');
  assert.match(resolved.context.thread_id, /^thread:/u);
  assert.match(resolved.actor_id ?? '', /^actor:provider:/u);
  assert.doesNotMatch(JSON.stringify(resolved), /external-thread|external-actor/u);
});

test('空白地址、非法枚举与空 interaction fail closed', () => {
  const valid = {
    provider_id: 'provider',
    provider_account_id: 'account',
    space_kind: 'direct',
    external_space_key: 'space',
    visibility: 'private',
  };
  assert.throws(() => directory.resolve({ ...valid, provider_id: '   ' }), /provider_id/u);
  assert.throws(() => directory.resolve({ ...valid, provider_account_id: '' }), /provider_account_id/u);
  assert.throws(() => directory.resolve({ ...valid, external_space_key: '\t' }), /external_space_key/u);
  assert.throws(() => directory.resolve({ ...valid, external_thread_key: '  ' }), /external_thread_key/u);
  assert.throws(() => directory.resolve({ ...valid, space_kind: 'session' }), /space_kind/u);
  assert.throws(() => directory.resolve({ ...valid, visibility: 'unknown' }), /visibility/u);
  assert.throws(() => directory.resolve(valid, '  '), /interaction_id/u);
});
