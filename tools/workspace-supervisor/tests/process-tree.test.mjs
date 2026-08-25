import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { terminateProcessTree } from '../src/process-tree.mjs';

test('Windows 使用 taskkill 回收完整进程树', async () => {
  let invocation;
  await terminateProcessTree(42, {
    platform: 'win32',
    spawnProcess: (command, args) => {
      invocation = { command, args };
      const child = new EventEmitter();
      setImmediate(() => child.emit('exit', 0));
      return child;
    },
  });
  assert.deepEqual(invocation, { command: 'taskkill.exe', args: ['/PID', '42', '/T', '/F'] });
});

test('POSIX 先 TERM 进程组再 KILL', async () => {
  const calls = [];
  await terminateProcessTree(42, {
    platform: 'linux',
    killProcess: (pid, signal) => calls.push([pid, signal]),
    delay: async () => {},
  });
  assert.deepEqual(calls, [[-42, 'SIGTERM'], [-42, 'SIGKILL']]);
});
