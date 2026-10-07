import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionResultOutbox, SqliteExecutionJournal } from '../src/index.js';

describe('Execution result/outbox 原子与幂等 receipt', () => {
  it('仅投递可路由的结果，接纳/ACK 丢失重投不重新派发；错误 receipt 不 ACK', async () => {
    const root = mkdtempSync(join(tmpdir(), 'glimmer-result-receiver-'));
    const file = join(root, 'execution.sqlite'); let journal = new SqliteExecutionJournal(file);
    try {
      const make = (id: string, route: boolean) => {
        const prepared = journal.prepare({ invocation_id: id, scope_id: 'private', idempotency_key: id,
          target: { executor_id: 'browser', capability_id: 'open', definition_revision: 'actual' }, input: null,
          ...(route ? { interaction: { conversation_id: 'private', source_fact_id: 'action:1' } } : {}) }, 1);
        return journal.finish(journal.dispatch(journal.authorize(prepared, {}, 2), 'owner', 3),
          { state: 'succeeded', result: null, side_effects: 'confirmed' }, 4);
      };
      make('unrouted', false); const invocation = make('routed', true);
      const event = journal.readOutbox(1, true)[0];
      expect(event.invocation.interaction).toEqual({ conversation_id: 'private', source_fact_id: 'action:1' });
      expect(() => journal.prepare({ invocation_id: 'routed', scope_id: 'private', idempotency_key: 'routed',
        target: invocation.target, input: null, interaction: { conversation_id: 'private', source_fact_id: 'other' } }, 5)).toThrow('冲突');
      const receipt = { event_id: event.event_id, invocation_id: invocation.invocation_id, revision: invocation.revision, accepted: true as const };
      const accept = vi.fn(async () => receipt);
      const aborted = new AbortController();
      const lost = new ExecutionResultOutbox(journal, { accept: async () => { aborted.abort(); return receipt; } }, () => 5);
      await expect(lost.publish(event, aborted.signal)).rejects.toThrow();
      expect(journal.readOutbox(1, true)).toHaveLength(1);
      journal.close(); journal = new SqliteExecutionJournal(file);
      const wrong = new ExecutionResultOutbox(journal, { accept: async () => ({ ...receipt, revision: 1 }) }, () => 6);
      expect(await wrong.deliverPending(1)).toEqual({ delivered: 0, failed: 1 });
      const outbox = new ExecutionResultOutbox(journal, { accept }, () => 7);
      await expect(outbox.publish({ ...event, invocation: { ...event.invocation, result: 'forged' } })).rejects.toThrow('不是已提交结果');
      expect(accept).not.toHaveBeenCalled();
      expect(await outbox.deliverPending(1)).toEqual({ delivered: 1, failed: 0 });
      expect(journal.readOutbox(10)).toHaveLength(1);
      expect(await outbox.publish(event)).toBe(true); expect(accept).toHaveBeenCalledTimes(2);
      await outbox.stop(); await expect(outbox.publish(event)).rejects.toThrow('停止接纳');
    } finally { journal.close(); rmSync(root, { recursive: true }); }
  });
  it('outbox 排空等待实际 receiver，不先关闭 journal', async () => {
    const root = mkdtempSync(join(tmpdir(), 'glimmer-outbox-drain-')); const journal = new SqliteExecutionJournal(join(root, 'execution.sqlite'));
    try {
      const prepared = journal.prepare({ invocation_id: 'i', scope_id: 'c', idempotency_key: 'i', input: null,
        target: { executor_id: 'e', capability_id: 't', definition_revision: 'r' },
        interaction: { conversation_id: 'c', source_fact_id: 'a' } }, 1);
      journal.reject(journal.authorize(prepared, {}, 2), 'denied', 3);
      const event = journal.readOutbox(1)[0]; let finish!: () => void;
      const wait = new Promise<void>(resolve => { finish = resolve; });
      const outbox = new ExecutionResultOutbox(journal, { accept: async () => { await wait;
        return { event_id: event.event_id, invocation_id: 'i', revision: event.invocation.revision, accepted: true }; } }, () => 4);
      const pending = outbox.publish(event); let stopped = false;
      const stopping = outbox.stop().then(() => { stopped = true; });
      await Promise.resolve(); expect(stopped).toBe(false);
      finish(); await pending; await stopping; expect(journal.readOutbox(1)).toEqual([]);
    } finally { journal.close(); rmSync(root, { recursive: true }); }
  });
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
