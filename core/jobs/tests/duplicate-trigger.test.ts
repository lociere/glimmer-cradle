import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobConflictError, JobTriggerController, SqliteJobStore, type JobRequest, type JobTriggerDefinition } from '../src/index.js';

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
