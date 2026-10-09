import type { Clock, StableIdentity } from '../src/index';
const test = require('node:test');
const assert = require('node:assert/strict');
const platform = require('@glimmer-cradle/platform') as typeof import('../src/index');

test('public SystemClock releases cancelled timers and keeps wall and monotonic time separate', async () => {
  const clock: Clock = new platform.SystemClock();
  assert.ok(Number.isFinite(clock.nowMs()));
  const before = clock.monotonicNowMs();
  let calls = 0;
  const task = clock.schedule(0, () => { calls += 1; });
  task.cancel(); task.cancel();
  await new Promise<void>(resolve => clock.schedule(5, resolve));
  assert.equal(calls, 0);
  assert.ok(clock.monotonicNowMs() >= before);
});

test('public stable identity preserves the original digest bytes and generates independent opaque ids', () => {
  const identity: StableIdentity = new platform.NodeStableIdentity();
  assert.match(identity.newId(), /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.notEqual(identity.newId(), identity.newId());
  // Golden compatibility values from the existing SHA-256/unit-separator contract.
  assert.equal(identity.digest([]), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(identity.digest(['abc']), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(identity.digest(['ab', 'c']), identity.digest(['a', 'bc']));
});

test('public lifecycle export owns the actual supervisor with no legacy aggregate entry required', async () => {
  const { LifecycleCoordinator } = require('@glimmer-cradle/platform/lifecycle') as typeof import('../src/lifecycle/supervisor');
  assert.equal(LifecycleCoordinator, platform.LifecycleCoordinator);
  const lifecycle = new LifecycleCoordinator({ monotonicNowMs: () => 0 });
  await lifecycle.stopStarted({ trace_id: 'public' });
  await assert.rejects(lifecycle.startPhase({ name: 'closed', modules: [] }, { trace_id: 'public' }), /已关闭/);
});
