import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionController, SqliteExecutionJournal } from '../src/index.js';

describe('Execution 派发前复验', () => {
  it.each([true, false])('授权 allowed=%s，撤销后不派发、不计 attempt', async (allowed) => {
    const root = mkdtempSync(join(tmpdir(), 'glimmer-revoked-')); const journal = new SqliteExecutionJournal(join(root, 'execution.sqlite'));
    try {
      const execute = vi.fn();
      const result = await new ExecutionController(journal).execute({ invocation_id: 'invoke', scope_id: 'scope', idempotency_key: 'key',
        target: { executor_id: 'receiver', capability_id: 'tool', definition_revision: 'actual' }, input: null }, {
        authorize: async () => ({ allowed, decision: { allowed } }), validateBeforeDispatch: () => false, execute,
      });
      expect(result).toMatchObject({ state: 'failed', attempt: 0, side_effects: 'none',
        error_code: allowed ? 'revoked_before_dispatch' : 'authorization_denied' });
      expect(execute).not.toHaveBeenCalled(); expect(journal.readOutbox(10)[0].invocation).toEqual(result);
    } finally { journal.close(); rmSync(root, { recursive: true }); }
  });
});
