import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolvePnpmInvocation } from '../src/package-manager-invocation.mjs';

test('Windows 优先使用 Node 自带 Corepack pnpm 入口', () => {
  const execPath = path.join('C:', 'node', 'node.exe');
  const expected = path.join('C:', 'node', 'node_modules', 'corepack', 'dist', 'pnpm.js');
  assert.deepEqual(resolvePnpmInvocation({
    platform: 'win32', execPath, repositoryRoot: path.join('D:', 'repo'),
    existsSync: (candidate) => candidate === expected,
  }), { command: execPath, prefix: [expected] });
});

test('POSIX 使用 Corepack 选择仓库锁定 pnpm', () => {
  assert.deepEqual(resolvePnpmInvocation({
    platform: 'linux', execPath: '/usr/bin/node', repositoryRoot: '/srv/repo',
  }), { command: 'corepack', prefix: ['pnpm'] });
});

test('Windows 缺少 pnpm 入口时稳定失败', () => {
  assert.throws(() => resolvePnpmInvocation({
    platform: 'win32', execPath: path.join('C:', 'node', 'node.exe'), repositoryRoot: path.join('D:', 'repo'),
    existsSync: () => false,
  }), (error) => error.exitCode === 69);
});
