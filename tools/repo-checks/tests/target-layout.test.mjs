import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { checkTargetLayout, compareTargetFiles, layoutPath, manifestPath, renderTargetLayout, validateTargetManifest, writeTargetLayout } from '../src/architecture/target-layout.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestPath), 'utf8'));

test('live specification is valid and rendered without omitted package files', () => {
  assert.deepEqual(checkTargetLayout(root), []);
  const tree = renderTargetLayout(manifest);
  for (const name of ['package.json', 'pyproject.toml', 'tsconfig.json', 'tests/', 'src/', 'pnpm-lock.yaml']) assert.ok(tree.includes(name));
});

test('rejects traversal, wildcard source entries, duplicate casing and file-directory collisions', () => {
  for (const entry of [
    { path: '../outside.ts', owner: 'test' }, { path: 'src/*.ts', owner: 'test' },
    { path: 'PACKAGE.JSON', owner: 'test' }, { path: 'package.json/child', owner: 'test' },
    { path: 'unowned.ts', owner: '' },
  ]) {
    const candidate = structuredClone(manifest);
    candidate.repositoryFiles.push(entry);
    assert.notDeepEqual(validateTargetManifest(candidate), [], entry.path);
  }
});

test('uses owner-qualified role names and Python snake_case', () => {
  const paths = new Set(manifest.repositoryFiles.map(entry => entry.path));
  for (const file of [
    'core/platform/src/topology/authority-lease.ts',
    'core/jobs/src/scheduling/job-lease.ts',
    'core/cognition/src/glimmer_cradle/cognition/attention/attention_lease.py',
    'core/conversation/src/glimmer_cradle/conversation/turns/turn_store_port.py',
    'core/conversation/src/glimmer_cradle/conversation/adapters/persistence/sqlite_turn_store.py',
    'extension-sdk/src/compatibility/version-compatibility.ts',
  ]) assert.ok(paths.has(file), file);
  for (const file of [
    'core/platform/src/topology/lease.ts',
    'core/jobs/src/scheduling/lease.ts',
    'core/conversation/src/glimmer_cradle/conversation/turns/turn_store.py',
    'extension-sdk/src/compatibility/compatibility.ts',
  ]) assert.ok(!paths.has(file), file);

  const candidate = structuredClone(manifest);
  candidate.repositoryFiles.push({ path: 'tools/checks/python-imports.py', owner: 'engineering' });
  assert.ok(validateTargetManifest(candidate).some(error => error.includes('snake_case')));
});

test('distinguishes missing target files from unlisted legacy files', () => {
  const candidate = { repositoryFiles: [{ path: 'core/platform/src/index.ts' }, { path: 'apps/host/package.json' }] };
  assert.deepEqual(compareTargetFiles(candidate, ['core/platform/src/index.ts', 'core/kernel/src/index.ts']), [
    'apps/host/package.json: missing target file', 'core/kernel/src/index.ts: unexpected final file',
  ]);
});

test('detects manual tree edits and restores only the generated section', t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'glimmer-target-layout-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.mkdirSync(path.dirname(path.join(fixture, manifestPath)), { recursive: true });
  fs.writeFileSync(path.join(fixture, manifestPath), JSON.stringify(manifest));
  fs.writeFileSync(path.join(fixture, layoutPath), 'before\n<!-- target-layout:start -->\nwrong\n<!-- target-layout:end -->\nafter\n');
  assert.match(checkTargetLayout(fixture)[0], /out of sync/);
  writeTargetLayout(fixture);
  assert.deepEqual(checkTargetLayout(fixture), []);
  const text = fs.readFileSync(path.join(fixture, layoutPath), 'utf8');
  assert.ok(text.startsWith('before\n'));
  assert.ok(text.endsWith('\nafter\n'));
});

test('final mode checks actual Git-visible files and rejects a directory standing in for a file', t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'glimmer-target-final-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const candidate = structuredClone(manifest);
  candidate.repositoryFiles = [manifestPath, layoutPath, 'entry.ts'].map(file => ({ path: file, owner: 'test' }));
  fs.mkdirSync(path.dirname(path.join(fixture, manifestPath)), { recursive: true });
  fs.writeFileSync(path.join(fixture, manifestPath), JSON.stringify(candidate));
  fs.writeFileSync(path.join(fixture, layoutPath), renderTargetLayout(candidate));
  fs.writeFileSync(path.join(fixture, 'entry.ts'), 'export {};');
  execFileSync('git', ['init', '--quiet'], { cwd: fixture });
  assert.deepEqual(checkTargetLayout(fixture, { final: true }), []);
  fs.writeFileSync(path.join(fixture, 'legacy.ts'), 'export {};');
  assert.ok(checkTargetLayout(fixture, { final: true }).some(error => error.includes('unexpected final file')));
  fs.unlinkSync(path.join(fixture, 'entry.ts'));
  fs.mkdirSync(path.join(fixture, 'entry.ts'));
  assert.ok(checkTargetLayout(fixture, { final: true }).some(error => error.includes('regular file')));
});
