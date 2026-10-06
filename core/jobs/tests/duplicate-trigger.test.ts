import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { JobAuthorityError, JobConflictError, JobTriggerController, SqliteJobStore, type JobRequest, type JobSource,
  type JobTriggerDefinition } from '../src/index.js';

const source: JobSource = { source_id: 'domain.owner', source_request_id: 'request-1', input_digest: 'a'.repeat(64) };
function sourceRequest(): JobRequest {
  return JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
}

it('源 inbox/首次政策/Job/outbox 同事务；写入失败不留下半接纳，双连接重投只有一次入队', () => {
  const databasePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-source-')), 'jobs.sqlite');
  const first = new SqliteJobStore(databasePath), second = new SqliteJobStore(databasePath), db = new Database(databasePath);
  const request = sourceRequest();
  try {
    first.activateAuthority(1, 1000);
    db.exec("CREATE TRIGGER reject_source BEFORE INSERT ON job_source_receipts BEGIN SELECT RAISE(ABORT,'injected source failure'); END;");
    expect(() => first.enqueueSource(source, request, 1, 1000)).toThrow('injected source failure');
    expect(first.load(request.job_id)).toBeNull();
    expect(first.readOutbox(1, 10)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM job_source_receipts').get()).toEqual({ count: 0 });
    db.exec('DROP TRIGGER reject_source');
    expect(first.enqueueSource(source, request, 1, 1000).duplicate).toBe(false);
    expect(second.enqueueSource(source, { ...request, due_at: 50_000, max_attempts: 1 }, 1, 1100))
      .toMatchObject({ duplicate: true, job: { due_at: 1000, max_attempts: 3 } });
    expect(first.readOutbox(1, 10)).toHaveLength(1);
    expect(db.prepare('SELECT initial_due_at,max_attempts,accepted_at FROM job_source_receipts').get())
      .toEqual({ initial_due_at: 1000, max_attempts: 3, accepted_at: 1000 });
  } finally { db.close(); first.close(); second.close(); }
});

it('源 ACK 丢失后重启切代；政策变化沿用首次预算，重试 due 不覆盖原接纳 due', () => {
  const databasePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-source-restart-')), 'jobs.sqlite');
  let store = new SqliteJobStore(databasePath);
  const request = sourceRequest();
  store.activateAuthority(1, 1000);
  store.enqueueSource(source, request, 1, 1000);
  const claim = store.claim(1, 'worker', 1000, 100)!;
  store.finish(claim.lease, 1001, { status: 'unknown' });
  store.reconcile({ job_id: request.job_id, scope_id: request.scope_id, attempt: 1, authority_epoch: 1,
    fencing_token: claim.lease.fencing_token, owner_id: 'worker', source_id: 'receiver', evidence_id: 'seal-1',
    observed_at: 1002, resolution: 'not_applied', receiver_fenced: true }, 1, store.load(request.job_id)!.revision,
  1002, { base_delay_ms: 25, max_delay_ms: 100 });
  store.close(); store = new SqliteJobStore(databasePath);
  try {
    store.activateAuthority(2, 1010);
    const before = store.load(request.job_id)!;
    expect(before).toMatchObject({ status: 'retry_wait', due_at: 1027, max_attempts: 3, attempt: 1 });
    expect(() => store.enqueueSource(source, request, 1, 1010)).toThrow(JobAuthorityError);
    expect(store.enqueueSource(source, { ...request, due_at: 90_000, max_attempts: 1 }, 2, 1010))
      .toMatchObject({ duplicate: true, job: before });
    expect(store.claim(2, 'new-worker', 1026, 100)).toBeNull();
    expect(store.claim(2, 'new-worker', 1027, 100)?.job).toMatchObject({ attempt: 2, max_attempts: 3 });
    // 非源入口仍要求完整不可变请求，不能用本次政策或可变 retry due 重放。
    expect(() => store.enqueue({ ...request, due_at: 1027 }, 2, 1027)).toThrow(JobConflictError);
  } finally { store.close(); }
});

it('源快照不容许信封、业务身份或重试模式漂移；对象键顺序中立，稳定 Job ID 不映射其他分配', () => {
  const store = new SqliteJobStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-source-conflict-')), 'jobs.sqlite'));
  const request = { ...sourceRequest(), payload: { a: 1, b: 2 } };
  try {
    store.activateAuthority(1, 1000); store.enqueueSource(source, request, 1, 1000);
    expect(store.enqueueSource(source, { ...request, payload: { b: 2, a: 1 } }, 1, 1001).duplicate).toBe(true);
    expect(() => store.enqueueSource({ ...source, input_digest: 'b'.repeat(64) }, request, 1, 1001)).toThrow(JobConflictError);
    for (const change of [{ job_id: 'other' }, { scope_id: 'other' }, { goal_id: 'other' }, { kind: 'other' },
      { idempotency_key: 'other' }, { payload: { a: 2, b: 2 } }, { retry_mode: 'idempotent' as const }]) {
      expect(() => store.enqueueSource(source, { ...request, ...change }, 1, 1001)).toThrow(JobConflictError);
    }
    expect(() => store.enqueueSource({ ...source, source_request_id: 'new' }, { ...request, job_id: 'other' }, 1, 1001))
      .toThrow('稳定 Job identity');
    expect(() => store.enqueueSource({ ...source, input_digest: 'not-a-digest' }, request, 1, 1001)).toThrow(JobConflictError);
    expect(() => store.enqueueSource({ ...source, source_id: ' ' }, request, 1, 1001)).toThrow(JobConflictError);
    expect(store.readOutbox(1, 100)).toHaveLength(1);
  } finally { store.close(); }
});

it('源最小快照不钉住终态 payload；retention 后重投仍返回同一 tombstone 且不重新执行', () => {
  const databasePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-source-retention-')), 'jobs.sqlite');
  let store = new SqliteJobStore(databasePath);
  const request = sourceRequest();
  store.activateAuthority(1, 1000); store.enqueueSource(source, request, 1, 1000);
  const claim = store.claim(1, 'worker', 1000, 100)!;
  store.finish(claim.lease, 1001, { status: 'succeeded' });
  for (const event of store.readOutbox(1, 100)) store.acknowledgeOutbox(event.event_id, 1, 2000);
  expect(store.pruneTerminal(1, 1500)).toBe(1);
  store.close(); store = new SqliteJobStore(databasePath);
  const db = new Database(databasePath);
  try {
    store.activateAuthority(2, 2000);
    expect(store.enqueueSource(source, { ...request, due_at: 5000, max_attempts: 1 }, 2, 2000))
      .toMatchObject({ duplicate: true, job_id: request.job_id, job: null });
    expect(store.claim(2, 'worker', 6000, 100)).toBeNull();
    expect(store.readOutbox(2, 100)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM job_source_receipts').get()).toEqual({ count: 1 });
    expect((db.pragma('table_info(job_source_receipts)') as { name: string }[]).map(row => row.name))
      .toEqual(['source_id', 'source_request_id', 'input_digest', 'job_id', 'request_identity_digest', 'initial_due_at', 'max_attempts', 'accepted_at']);
    db.prepare('UPDATE job_source_receipts SET initial_due_at=999').run();
    expect(() => store.enqueueSource(source, request, 2, 2000)).toThrow(JobConflictError);
    db.prepare('UPDATE job_source_receipts SET initial_due_at=1000').run();
    db.prepare('DELETE FROM job_tombstones WHERE job_id=?').run(request.job_id);
    expect(() => store.enqueueSource(source, request, 2, 2000)).toThrow('缺少 Job/tombstone');
    expect(store.load(request.job_id)).toBeNull();
  } finally { db.close(); store.close(); }
});

it('重复 trigger 去重、对象键顺序中立、内容冲突失败关闭、scope 隔离', () => {
  const store = new SqliteJobStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-trigger-')), 'jobs.sqlite'));
  const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
  try {
    store.activateAuthority(1, 1000);
    const trigger = new JobTriggerController(store, { now: () => 1000 }, 1);
    const first = trigger.submit({ ...request, payload: { a: 1, b: 2 } });
    const repeated = trigger.submit({ ...request, job_id: 'new-allocation', payload: { b: 2, a: 1 } });
    expect(repeated).toMatchObject({ duplicate: true, job_id: first.job_id });
    expect(() => trigger.submit({ ...request, payload: { a: 2, b: 2 } })).toThrow(JobConflictError);
    expect(() => trigger.submit({ ...request, due_at: 1001, payload: { a: 1, b: 2 } })).toThrow(JobConflictError);
    expect(trigger.submit({ ...request, job_id: 'job-2', scope_id: 'scope-2' }).duplicate).toBe(false);
    expect(() => trigger.submit({ ...request, job_id: 'job-2', payload: { a: 1, b: 2 } })).toThrow(JobConflictError);
  } finally { store.close(); }
});

it('事件 trigger 持久去重/冲突检测，停用只拒绝新 occurrence，已确认事件重试仍返回同身份', () => {
  const databasePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-event-')), 'jobs.sqlite');
  let store = new SqliteJobStore(databasePath);
  const definition: JobTriggerDefinition = {
    trigger_id: 'event-trigger', scope_id: 'scope-1', goal_id: 'goal-1', kind: 'test.event',
    payload: { stable: true }, retry_mode: 'reconcile', max_attempts: 3, schedule: null,
  };
  const event = { event_id: 'event-1', occurred_at: 1000, payload: { evidence_id: 'fact-1' } };
  store.activateAuthority(1, 1100);
  const trigger = new JobTriggerController(store, { now: () => 1100 }, 1);
  const registered = trigger.register(definition);
  const first = trigger.emit(definition.trigger_id, event);
  expect(first.duplicate).toBe(false);
  expect(first.job?.payload).toEqual({ input: { stable: true }, occurrence: {
    occurrence_id: 'event:event-1', occurred_at: 1000, payload: event.payload,
  } });
  store.close();
  store = new SqliteJobStore(databasePath);
  try {
    const restarted = new JobTriggerController(store, { now: () => 1200 }, 1);
    expect(restarted.register(definition).revision).toBe(registered.revision);
    expect(restarted.emit(definition.trigger_id, event)).toMatchObject({ duplicate: true, job_id: first.job_id });
    expect(() => restarted.emit(definition.trigger_id, { ...event, payload: { evidence_id: 'changed' } })).toThrow(JobConflictError);
    expect(() => restarted.register({ ...definition, payload: { stable: false } })).toThrow(JobConflictError);
    expect(restarted.setEnabled(definition.trigger_id, registered.revision, false)?.enabled).toBe(false);
    expect(restarted.setEnabled(definition.trigger_id, registered.revision, true)).toBeNull();
    expect(restarted.register(definition).enabled).toBe(false);
    expect(restarted.emit(definition.trigger_id, event).duplicate).toBe(true);
    expect(() => restarted.emit(definition.trigger_id, { ...event, event_id: 'new-event' })).toThrow('停用');
    expect(() => restarted.emit(definition.trigger_id, { ...event, occurred_at: 1300 })).toThrow('time');
    store.activateAuthority(2, 1200);
    expect(() => restarted.emit(definition.trigger_id, event)).toThrow('authority');
  } finally { store.close(); }
});
