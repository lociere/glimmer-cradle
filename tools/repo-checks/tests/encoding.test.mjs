import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkEncoding, listInventoriedTextFiles } from '../src/encoding/check-encoding.mjs';

async function createGitFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'glimmer-encoding-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  return root;
}

test('encoding inventory 同时覆盖 tracked 与未忽略的 untracked text', async () => {
  const root = await createGitFixture();
  try {
    await writeFile(path.join(root, 'tracked.md'), 'tracked\n');
    execFileSync('git', ['add', 'tracked.md'], { cwd: root });
    await writeFile(path.join(root, 'untracked.mjs'), 'export {};\n');
    await writeFile(path.join(root, 'binary.dat'), Buffer.from([0xff]));
    assert.deepEqual(listInventoriedTextFiles(root), ['tracked.md', 'untracked.mjs']);
    assert.deepEqual(checkEncoding(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('encoding check 区分 BOM 与非法 UTF-8', async () => {
  const root = await createGitFixture();
  try {
    await writeFile(path.join(root, 'bom.md'), Buffer.from([0xef, 0xbb, 0xbf, 0x61]));
    await writeFile(path.join(root, 'invalid.ts'), Buffer.from([0xc3, 0x28]));
    const violations = checkEncoding(root);
    assert.ok(violations.some((item) => item.includes('bom.md') && item.includes('BOM')));
    assert.ok(violations.some((item) => item.includes('invalid.ts') && item.includes('UTF-8')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('已从 worktree 删除的 tracked text 不制造编码失败', async () => {
  const root = await createGitFixture();
  try {
    const filePath = path.join(root, 'removed.md');
    await writeFile(filePath, 'removed\n');
    execFileSync('git', ['add', 'removed.md'], { cwd: root });
    await unlink(filePath);
    assert.deepEqual(checkEncoding(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
