import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkArchitectureBaselineLock } from '../src/architecture/baseline-lock.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..', '..');

test('accepts the frozen Architecture Baseline v2 lock', () => {
  assert.deepEqual(checkArchitectureBaselineLock(repositoryRoot), []);
});

test('rejects a missing or changed lock before reading source documents', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'glimmer-baseline-lock-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.match(checkArchitectureBaselineLock(root)[0], /lock is missing/);
  const target = path.join(root, 'docs/architecture/blueprint/architecture-baseline-v2.lock.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ schemaVersion: 2 }));
  assert.match(checkArchitectureBaselineLock(root)[0], /decisions changed/);
});
