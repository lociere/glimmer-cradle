import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '..', '..');

test('architecture CLI 从非 repository cwd 成功运行并保留失败 exit code', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'glimmer-repo-checks-cli-'));
  try {
    const success = spawnSync(process.execPath, [
      path.join(packageRoot, 'src', 'architecture', 'cli.mjs'),
      '--repository-root', repositoryRoot,
    ], { cwd, encoding: 'utf8' });
    assert.equal(success.status, 0, success.stderr);
    const failure = spawnSync(process.execPath, [
      path.join(packageRoot, 'src', 'architecture', 'cli.mjs'), '--unknown',
    ], { cwd, encoding: 'utf8' });
    assert.equal(failure.status, 2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
