import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkArchitecture } from '../src/architecture/check-architecture.mjs';
import { checkRepositoryTopology } from '../src/architecture/rules/repository-topology.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('当前 repository 满足模块化 architecture rules', () => {
  assert.deepEqual(checkArchitecture(repositoryRoot), []);
});

test('工具拓扑不限制未来合规叶子数量', () => {
  const leaf = path.join(repositoryRoot, 'tools', 'future-fixture-tool');
  try {
    fs.mkdirSync(path.join(leaf, 'src'), { recursive: true });
    fs.mkdirSync(path.join(leaf, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(leaf, 'package.json'), JSON.stringify({
      name: '@glimmer-cradle/future-fixture-tool',
      private: true,
      scripts: { test: 'node --test' },
    }));
    assert.deepEqual(checkRepositoryTopology(repositoryRoot), []);
  } finally {
    fs.rmSync(leaf, { recursive: true, force: true });
  }
});
