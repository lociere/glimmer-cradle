import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(packageRoot, '..', '..');

test('docs CLI exposes success, invalid heading and invocation failure as exit 0/1/2', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-docs-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'docs'));
  const entry = path.join(root, 'docs', 'README.md');
  writeFileSync(entry, '# Guide\n\n[section](#guide)\n');
  const run = args => spawnSync(process.execPath, [path.join(packageRoot, 'src/docs/cli.mjs'), ...args],
    { cwd: os.tmpdir(), encoding: 'utf8' });
  const success = run(['--repository-root', root]);
  assert.equal(success.status, 0, success.stderr);
  writeFileSync(entry, '# Guide\n\n[section](#removed)\n');
  const broken = run(['--repository-root', root]);
  assert.equal(broken.status, 1, broken.stderr);
  assert.match(broken.stderr, /missing Markdown heading/);
  const invalid = run(['--unknown']);
  assert.equal(invalid.status, 2);
});

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
