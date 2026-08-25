import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepareSmokeDataRoot } from '../scripts/smoke.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('Smoke 通过 workspace-supervisor 直接 CLI 启动生产组合', async () => {
  const source = await readFile(
    path.join(repoRoot, 'products', 'personal-server', 'scripts', 'smoke.mjs'),
    'utf8',
  );
  assert.match(source, /tools['"],\s*['"]workspace-supervisor['"],\s*['"]src['"],\s*['"]cli\.mjs/);
  assert.match(source, /'--mode', 'production'/);
  assert.doesNotMatch(source, /scripts['"],\s*['"]launch-product\.mjs/);
});

test('Smoke 使用真实隔离副本，修改副本不会回写源数据', async () => {
  const source = await mkdtemp(path.join(os.tmpdir(), 'glimmer-smoke-source-'));
  let copy;
  try {
    await mkdir(path.join(source, 'data', 'models'), { recursive: true });
    await mkdir(path.join(source, 'data', 'packages'), { recursive: true });
    await writeFile(path.join(source, 'data', 'models', 'model.txt'), 'source');
    copy = await prepareSmokeDataRoot(source);
    await writeFile(path.join(copy, 'models', 'model.txt'), 'copy');
    assert.equal(await readFile(path.join(source, 'data', 'models', 'model.txt'), 'utf8'), 'source');
  } finally {
    if (copy) await rm(copy, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }
});

test('Smoke 拒绝数据树中的 symlink/junction 投影', async () => {
  const source = await mkdtemp(path.join(os.tmpdir(), 'glimmer-smoke-link-'));
  try {
    await mkdir(path.join(source, 'data', 'models'), { recursive: true });
    await mkdir(path.join(source, 'outside'), { recursive: true });
    await symlink(path.join(source, 'outside'), path.join(source, 'data', 'models', 'linked'), 'junction');
    await assert.rejects(() => prepareSmokeDataRoot(source), /Smoke 副本拒绝链接/);
  } finally {
    await rm(source, { recursive: true, force: true });
  }
});
