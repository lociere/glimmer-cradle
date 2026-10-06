import type { AuthorityLease, AuthorityRecord, AuthorityStorePort } from '../src/index';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AuthorityConflictError, HandoverController, isAuthorityCurrent, validateAuthorityLease } = require('../dist/index.js');

const lease: AuthorityLease = { aggregate_id: 'jobs', owner_id: 'old', epoch: 1, fencing_token: 1, expires_at: 2000, revision: 1 };
test('authority 机制区分 expiry、撤销和不可替换 identity；续期 revision 不替代 epoch', () => {
  const current: AuthorityRecord = { ...lease, revision: 2, expires_at: 3000, status: 'active', updated_at: 1000 };
  assert.equal(isAuthorityCurrent(current, lease, 2000), true);
  assert.equal(isAuthorityCurrent(current, lease, 3000), false);
  assert.equal(isAuthorityCurrent({ ...current, status: 'revoking' }, lease, 1500), false);
  for (const drift of [{ epoch: 2 }, { owner_id: 'new' }, { fencing_token: 2 }, { aggregate_id: 'other' }]) {
    assert.equal(isAuthorityCurrent({ ...current, ...drift }, lease, 1500), false);
  }
  assert.throws(() => validateAuthorityLease({ ...lease, epoch: Number.MAX_SAFE_INTEGER + 1 }), AuthorityConflictError);
});
test('handover 先撤销，再完成真正 drain；错身份不确认，不将非法 ttl 留成 revoking', async () => {
  const events: string[] = [];
  const handover = { transfer_id: 'transfer', from: lease, next_owner_id: 'new', prepared_revision: 2 };
  const store = {
    beginHandover() { events.push('revoke'); return handover; },
    completeHandover() { events.push('confirm'); return { ...lease, owner_id: 'new', epoch: 2 }; },
  } as unknown as AuthorityStorePort;
  const controller = new HandoverController(store, { now: () => 1000 });
  let releaseDrain!: () => void;
  const pending = controller.transfer(lease, 'new', 'transfer', { async revokeAndDrain() {
    events.push('drain'); await new Promise<void>(resolve => { releaseDrain = resolve; });
    return { ...lease, transfer_id: 'transfer', drained: true as const };
  } }, 1000);
  assert.deepEqual(events, ['revoke', 'drain']);
  releaseDrain();
  assert.equal((await pending).epoch, 2);
  assert.deepEqual(events, ['revoke', 'drain', 'confirm']);
  events.length = 0;
  await assert.rejects(controller.transfer(lease, 'new', 'transfer', { async revokeAndDrain() {
    return { ...lease, epoch: 99, transfer_id: 'transfer', drained: true as const };
  } }, 1000), AuthorityConflictError);
  assert.deepEqual(events, ['revoke']);
  events.length = 0;
  await assert.rejects(controller.transfer(lease, 'new', 'transfer', { async revokeAndDrain() { throw new Error('unused'); } }, 0), AuthorityConflictError);
  assert.deepEqual(events, []);
});
