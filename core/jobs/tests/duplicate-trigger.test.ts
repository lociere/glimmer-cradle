import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobConflictError, JobTriggerController, SqliteJobStore, type JobRequest } from '../src/index.js';

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
