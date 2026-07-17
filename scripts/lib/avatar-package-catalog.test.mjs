import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadAvatarPackageCatalog } from './avatar-package-catalog.mjs';

test('没有本机 Avatar Package 时返回明确空目录', async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'glimmer-avatar-empty-'));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));

  const catalog = await loadAvatarPackageCatalog(repoRoot);

  assert.deepEqual(catalog, {
    defaultAvatarPackageId: '',
    defaultModelId: '',
    packages: [],
  });
});

test('本机 Avatar Package 保留唯一默认项', async (t) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'glimmer-avatar-package-'));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  const packageRoot = path.join(repoRoot, 'assets', 'avatar', 'avatar-packages', 'local-avatar');
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.writeFile(path.join(packageRoot, 'avatar-package.json'), JSON.stringify({
    id: 'local-avatar',
    default: true,
    characterId: 'local-character',
    modelId: 'local-model',
    displayName: 'Local Avatar',
    kind: 'live2d',
    preferredBackend: 'unity',
    live2dVersion: 'cubism5',
    assetRootPath: 'assets/avatar/local-model',
    modelPath: 'assets/avatar/local-model/model.model3.json',
  }), 'utf8');

  const catalog = await loadAvatarPackageCatalog(repoRoot);

  assert.equal(catalog.defaultAvatarPackageId, 'local-avatar');
  assert.equal(catalog.defaultModelId, 'local-model');
  assert.equal(catalog.packages.length, 1);
  assert.equal(catalog.packages[0].default, true);
});
