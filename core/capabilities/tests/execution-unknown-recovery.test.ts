import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecutionController, ExecutionConflictError, ExecutionRecoveryRequiredError, SqliteExecutionJournal } from '../src/index.js';
import type { ExecutorPort, InvocationRequest } from '../src/index.js';

const roots: string[] = [];
const journals: SqliteExecutionJournal[] = [];
function path(): string { const root = mkdtempSync(join(tmpdir(), 'glimmer-execution-')); roots.push(root); return join(root, 'execution.sqlite'); }
function open(file = path()): SqliteExecutionJournal { const journal = new SqliteExecutionJournal(file); journals.push(journal); return journal; }
function close(journal: SqliteExecutionJournal): void { journal.close(); journals.splice(journals.indexOf(journal), 1); }
const request: InvocationRequest = { invocation_id: 'invoke:1', scope_id: 'conversation:1', idempotency_key: 'operation:1',
  target: { executor_id: 'receiver:1', capability_id: 'tool:1', definition_revision: 'actual-definition:1' }, input: { message: '你好' } };
function executor(execute: ExecutorPort['execute'] = async () => ({ state: 'succeeded', result: { ok: true }, side_effects: 'confirmed' })): ExecutorPort {
  return { authorize: async () => ({ allowed: true, decision: { allowed: true } }), validateBeforeDispatch: () => true, execute };
}
afterEach(() => { for (const journal of journals.splice(0)) journal.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true }); });

describe('持久 Execution 不明结果与竞争', () => {
  it('跨数据库连接 CAS 只允许一次派发，第二次打开不接管活跃 owner', async () => {
    const file = path(); const first = open(file); const second = open(file);
    let finish!: () => void;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    const called = vi.fn(async () => { await blocked; return { state: 'succeeded' as const, result: 'done', side_effects: 'confirmed' as const }; });
    const a = new ExecutionController(first); const b = new ExecutionController(second);
    const pending = a.execute(request, executor(called));
    await new Promise(resolve => setImmediate(resolve));
    expect(first.load(request.invocation_id)?.state).toBe('dispatched');
    await expect(b.execute(request, executor(called))).rejects.toBeInstanceOf(ExecutionRecoveryRequiredError);
    finish(); await expect(pending).resolves.toMatchObject({ state: 'succeeded', attempt: 1 });
    expect(called).toHaveBeenCalledOnce();
    await expect(b.execute(request, executor(called))).resolves.toMatchObject({ result: 'done' });
    expect(called).toHaveBeenCalledOnce();
  });
  it('同 controller 合并相同请求，冲突内容不合并，不泄漏原输入', async () => {
    const file = path(); const journal = open(file); const controller = new ExecutionController(journal);
    const called = vi.fn(async (input: InvocationRequest) => {
      expect(Object.isFrozen(input.input)).toBe(true);
      return { state: 'succeeded' as const, result: input.input, side_effects: 'none' as const };
    });
    const first = controller.execute(request, executor(called));
    const duplicate = controller.execute(request, executor(called));
    expect(first).toBe(duplicate);
    await expect(controller.execute({ ...request, input: 'different' }, executor(called))).rejects.toBeInstanceOf(ExecutionConflictError);
    await first;
    const db = new Database(file, { readonly: true });
    try { expect(db.prepare('PRAGMA table_info(executions)').all()).not.toContainEqual(expect.objectContaining({ name: 'input_json' })); }
    finally { db.close(); }
    expect(called).toHaveBeenCalledOnce();
  });
  it('崩溃留下 dispatched：重开仍要求恢复，不猜测 failed，不自动重试', async () => {
    const file = path(); const journal = open(file);
    const prepared = journal.prepare(request, 1);
    const authorized = journal.authorize(prepared, { allowed: true }, 2);
    journal.dispatch(authorized, 'stopped-process', 3); close(journal);
    const reopened = open(file); const called = vi.fn();
    await expect(new ExecutionController(reopened).execute(request, executor(called))).rejects.toBeInstanceOf(ExecutionRecoveryRequiredError);
    expect(reopened.load(request.invocation_id)).toMatchObject({ state: 'dispatched', side_effects: 'unknown', attempt: 1 });
    expect(reopened.readOutbox(10)).toEqual([]); expect(called).not.toHaveBeenCalled();
  });
  it('派发异常落 unknown 与 outbox，重开不执行第二次', async () => {
    const file = path(); const journal = open(file); const called = vi.fn(async () => { throw new Error('connection lost'); });
    await expect(new ExecutionController(journal).execute(request, executor(called))).rejects.toBeInstanceOf(ExecutionRecoveryRequiredError);
    expect(journal.load(request.invocation_id)).toMatchObject({ state: 'unknown', error_code: 'executor_unconfirmed' });
    expect(journal.readOutbox(10)[0].invocation.state).toBe('unknown'); close(journal);
    await expect(new ExecutionController(open(file)).execute(request, executor(called))).rejects.toBeInstanceOf(ExecutionRecoveryRequiredError);
    expect(called).toHaveBeenCalledOnce();
  });
  it('排空等待真实 handler：取消之后确认成功仍保存成功', async () => {
    const journal = open(); const controller = new ExecutionController(journal);
    let finish!: () => void; let signal!: AbortSignal;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    const pending = controller.execute(request, executor(async (_request, actualSignal) => {
      signal = actualSignal; await blocked;
      return { state: 'succeeded', result: 'confirmed-after-cancel', side_effects: 'confirmed' };
    }));
    await new Promise(resolve => setImmediate(resolve));
    let stopped = false; const draining = controller.stop().then(() => { stopped = true; });
    await new Promise(resolve => setImmediate(resolve));
    expect(signal.aborted).toBe(true); expect(stopped).toBe(false);
    await expect(controller.execute({ ...request, invocation_id: 'other' }, executor())).rejects.toThrow('停止接纳');
    finish(); await pending; await draining;
    expect(journal.load(request.invocation_id)?.state).toBe('succeeded');
  });
  it('结果无法持久化时维持 dispatched/unknown 语义，不重跑或伪造 failed', async () => {
    const file = path(); const journal = open(file);
    const raw = new Database(file);
    raw.exec("CREATE TRIGGER reject_outbox BEFORE INSERT ON execution_outbox BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    raw.close();
    const controller = new ExecutionController(journal); const called = vi.fn(async () => ({ state: 'succeeded' as const, result: 'side-effect-applied', side_effects: 'confirmed' as const }));
    await expect(controller.execute(request, executor(called))).rejects.toBeInstanceOf(ExecutionRecoveryRequiredError);
    expect(journal.load(request.invocation_id)?.state).toBe('dispatched'); expect(journal.readOutbox(10)).toEqual([]);
    await expect(controller.execute(request, executor(called))).rejects.toBeInstanceOf(ExecutionRecoveryRequiredError);
    expect(called).toHaveBeenCalledOnce();
  });
  it('未知 owner/version/部分 schema 不重置；空 foreign owner 也不覆盖', () => {
    for (const setup of ["PRAGMA application_id=7", "PRAGMA user_version=9", 'CREATE TABLE foreign_data(value TEXT)',
      'PRAGMA application_id=1195591000; PRAGMA user_version=1; CREATE TABLE executions(invocation_id TEXT)']) {
      const file = path(); const db = new Database(file); db.exec(setup); db.close();
      expect(() => new SqliteExecutionJournal(file)).toThrow();
      const unchanged = new Database(file); try {
        expect(unchanged.prepare("SELECT name FROM sqlite_master WHERE name='execution_outbox'").all()).toEqual([]);
      } finally { unchanged.close(); }
    }
  });
  it('JSON 不接受稀疏数组、循环、非有限数、accessor 或非 JSON 对象', () => {
    const journal = open(); const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const getter = Object.defineProperty({}, 'secret', { get: () => { throw new Error('must not run'); }, enumerable: true });
    for (const input of [Array(2), cycle, NaN, new Date(), getter, { value: undefined }, 'x'.repeat(65537)]) {
      expect(() => journal.prepare({ ...request, input }, 1)).toThrow(ExecutionConflictError);
    }
    expect(journal.load(request.invocation_id)).toBeNull();
  });
  it('稳定 invocation/key、定义或参数冲突均拒绝，不重置第一次调用', () => {
    const journal = open(); journal.prepare(request, 1);
    for (const change of [{ input: 'other' }, { invocation_id: 'other' }, { scope_id: 'other' },
      { target: { ...request.target, definition_revision: 'changed' } }]) {
      expect(() => journal.prepare({ ...request, ...change }, 2)).toThrow(ExecutionConflictError);
    }
    expect(journal.load(request.invocation_id)?.revision).toBe(1);
  });
});
