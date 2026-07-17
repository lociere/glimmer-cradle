import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { resolvePnpmInvocation } from './package-manager-command.mjs';

test('Windows 优先使用 Node 自带的 Corepack pnpm 入口', () => {
  const execPath = path.join('C:', 'node', 'node.exe');
  const corepackPnpm = path.join('C:', 'node', 'node_modules', 'corepack', 'dist', 'pnpm.js');
  const invocation = resolvePnpmInvocation({
    platform: 'win32',
    execPath,
    repoRoot: path.join('D:', 'repo'),
    existsSync: (candidate) => candidate === corepackPnpm,
  });

  assert.deepEqual(invocation, { command: execPath, prefix: [corepackPnpm] });
});

test('非 Windows 通过 Corepack 选择仓库锁定的 pnpm 版本', () => {
  assert.deepEqual(resolvePnpmInvocation({
    platform: 'linux',
    execPath: '/usr/bin/node',
    repoRoot: '/srv/glimmer-cradle',
  }), { command: 'corepack', prefix: ['pnpm'] });
});

test('缺少 Corepack 和项目 pnpm 时给出明确错误', () => {
  assert.throws(() => resolvePnpmInvocation({
    platform: 'win32',
    execPath: path.join('C:', 'node', 'node.exe'),
    repoRoot: path.join('D:', 'repo'),
    existsSync: () => false,
  }), /corepack enable/);
});
