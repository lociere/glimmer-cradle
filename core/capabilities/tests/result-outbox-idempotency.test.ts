import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqliteExecutionJournal } from '../src/index.js';

describe('Execution result/outbox 原子与幂等 receipt', () => {
  it('重开返回原结果/outbox，错 receipt 不 ACK，ACK 丢失后重复确认无害', () => {
    const root = mkdtempSync(join(tmpdir(), 'glimmer-result-outbox-')); const file = join(root, 'execution.sqlite');
    let journal = new SqliteExecutionJournal(file);
    try {
      const request = { invocation_id: 'invoke:1', scope_id: 'scope:1', idempotency_key: 'key:1',
        target: { executor_id: 'receiver', capability_id: 'tool', definition_revision: 'actual' }, input: { private_input: 'not stored' } };
      const prepared = journal.prepare(request, 1); const authorized = journal.authorize(prepared, { allowed: true }, 2);
      const dispatched = journal.dispatch(authorized, 'owner', 3);
      const final = journal.finish(dispatched, { state: 'succeeded', result: { text: '实际结果' }, side_effects: 'confirmed' }, 4);
      const events = journal.readOutbox(10); expect(events).toHaveLength(1);
      journal.close(); journal = new SqliteExecutionJournal(file);
      expect(journal.prepare(request, 5)).toEqual(final); expect(journal.readOutbox(10)).toEqual(events);
      const event = events[0]; const receipt = { event_id: event.event_id, invocation_id: final.invocation_id, revision: final.revision, accepted: true as const };
      expect(() => journal.acknowledgeOutbox({ ...receipt, invocation_id: 'wrong' }, 6)).toThrow('冲突');
      expect(() => journal.acknowledgeOutbox({ ...receipt, revision: 1 }, 6)).toThrow('冲突');
      expect(journal.readOutbox(1)).toHaveLength(1);
      expect(journal.acknowledgeOutbox(receipt, 6)).toBe(true);
      journal.close(); journal = new SqliteExecutionJournal(file);
      expect(journal.acknowledgeOutbox(receipt, 7)).toBe(true); expect(journal.readOutbox(10)).toEqual([]);
      expect(journal.acknowledgeOutbox({ ...receipt, event_id: 'absent' }, 7)).toBe(false);
      for (const limit of [0, 1001, NaN, 1.5]) expect(() => journal.readOutbox(limit)).toThrow();
    } finally { journal.close(); rmSync(root, { recursive: true }); }
  });
});
