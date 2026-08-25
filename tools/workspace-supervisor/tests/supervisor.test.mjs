import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { superviseWorkspace } from '../src/supervisor.mjs';

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
  }
}

function basePlan({ preparation } = {}) {
  return {
    repositoryRoot: '/repo',
    preparation,
    environment: { GLIMMER_CRADLE_PRODUCT_MANIFEST: '/repo/products/desktop/product.json' },
    services: [
      { id: 'kernel', command: 'pnpm', args: ['kernel'] },
      { id: 'desktop', command: 'pnpm', args: ['desktop'] },
    ],
  };
}

test('正常主进程退出后给 sibling 自然退出窗口，再收口进程树并返回 0', async () => {
  const children = [];
  const terminated = [];
  const promise = superviseWorkspace(basePlan(), {
    spawnProcess: () => {
      const child = new FakeChild(100 + children.length);
      children.push(child);
      if (children.length === 1) setImmediate(() => child.emit('exit', 0, null));
      return child;
    },
    signalSource: new EventEmitter(),
    terminateTree: async (pid) => terminated.push(pid),
    delay: async () => {},
    gracefulWaitMs: 1,
    logger: { info() {}, error() {} },
  });
  assert.equal(await promise, 0);
  assert.deepEqual(terminated, [101]);
});

test('异常退出原样传播非零 code 并立即关闭 sibling', async () => {
  const children = [];
  const terminated = [];
  const promise = superviseWorkspace(basePlan(), {
    spawnProcess: () => {
      const child = new FakeChild(200 + children.length);
      children.push(child);
      if (children.length === 1) setImmediate(() => child.emit('exit', 23, null));
      return child;
    },
    signalSource: new EventEmitter(),
    terminateTree: async (pid) => terminated.push(pid),
    logger: { info() {}, error() {} },
  });
  assert.equal(await promise, 23);
  assert.deepEqual(terminated, [201]);
});

test('signal 触发整个故障域清理', async () => {
  const signalSource = new EventEmitter();
  const terminated = [];
  const promise = superviseWorkspace(basePlan(), {
    spawnProcess: (() => { let pid = 300; return () => new FakeChild(pid++); })(),
    signalSource,
    terminateTree: async (pid) => terminated.push(pid),
    logger: { info() {}, error() {} },
  });
  setImmediate(() => signalSource.emit('SIGTERM'));
  assert.equal(await promise, 0);
  assert.deepEqual(terminated.sort(), [300, 301]);
});

test('preparation failure 不吞 child exit code，也不启动服务', async () => {
  let calls = 0;
  await assert.rejects(() => superviseWorkspace(basePlan({ preparation: {
    command: 'pnpm', args: ['prepare'],
  } }), {
    spawnProcess: () => {
      calls += 1;
      const child = new FakeChild(400);
      setImmediate(() => child.emit('exit', 17, null));
      return child;
    },
  }), (error) => error.exitCode === 17);
  assert.equal(calls, 1);
});
