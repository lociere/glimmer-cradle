import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(__filename);
describe('Capabilities 构建公开入口', () => {
  it('只公开真实实现的 scope/execution，不暴露空 Registry 或内部路径', () => {
    const built = require('../dist/index.js');
    expect(Object.keys(built).sort()).toEqual(['ExecutionConflictError', 'ExecutionController',
      'ExecutionRecoveryRequiredError', 'ExecutionResultOutbox', 'GLOBAL_CAPABILITY_SCOPE', 'SqliteExecutionJournal',
      'executionDigest', 'isCapabilityScopeVisible']);
    expect(built.isCapabilityScopeVisible(undefined, undefined)).toBe(true);
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
    expect(manifest.version).toBe('0.1.0');
    expect(Object.keys(manifest.exports)).toEqual(['.']);
    expect(manifest.dependencies).toEqual({ 'better-sqlite3': '13.0.3' });
    expect(manifest.files).toContain('migrations');
  });
});
