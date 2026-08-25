import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '..', '..');
const cli = path.join(packageRoot, 'src', 'cli.mjs');

test('直接 CLI 可从非 repository cwd 规划 Desktop/PS，并对未知产品返回稳定失败', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'glimmer-supervisor-cli-'));
  try {
    for (const productId of ['desktop', 'personal-server']) {
      const result = spawnSync(process.execPath, [
        cli, '--mode', 'development', '--plan', productId, '--repository-root', repositoryRoot,
      ], { cwd, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).productId, productId);
    }
    const failure = spawnSync(process.execPath, [
      cli, '--mode', 'development', '--plan', 'unknown-product', '--repository-root', repositoryRoot,
    ], { cwd, encoding: 'utf8' });
    assert.equal(failure.status, 66);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
