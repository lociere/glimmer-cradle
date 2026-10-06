import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobController, JobRetentionController, SqliteJobStore, type JobRequest } from '../src/index.js';

it('取消先持久撤销租约，晚到 handler 成功不能覆盖 cancelled，stop 等待实际收尾', async () => {
  const store = new SqliteJobStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-cancel-')), 'jobs.sqlite'));
  const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
  const controller = new JobController(store, { now: () => 1000 }, { base_delay_ms: 25, max_delay_ms: 100 });
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let signal!: AbortSignal;
  try {
    store.activateAuthority(1, 1000);
    store.enqueue(request, 1, 1000);
    controller.register({ kind: request.kind, retry_mode: 'reconcile', async execute(context) {
      signal = context.signal;
      entered();
      await blocked;
      return { status: 'succeeded', result: { late: true } };
    } });
    const claim = store.claim(1, 'worker-1', 1000, 100)!;
    const pending = controller.execute(claim);
    expect(controller.execute(claim)).toBe(pending);
    await started;
    expect(controller.cancel(request.job_id, 1, claim.job.revision - 1)).toBeNull();
    expect(signal.aborted).toBe(false);
    expect(controller.cancel(request.job_id, 1, claim.job.revision)?.status).toBe('cancelled');
    expect(signal.aborted).toBe(true);
    let drained = false;
    const stopped = controller.stop().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await pending;
    await stopped;
    expect(store.load(request.job_id)).toMatchObject({ status: 'cancelled', result: null });
  } finally { release(); await controller.stop(); store.close(); }
});

it('retention 保留去重 tombstone，不删除 unknown 或活跃工作', () => {
  const store = new SqliteJobStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-retention-')), 'jobs.sqlite'));
  const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
  try {
    store.activateAuthority(1, 1000);
    store.enqueue(request, 1, 1000);
    const done = store.claim(1, 'worker', 1000, 100)!;
    store.finish(done.lease, 1001, { status: 'succeeded' });
    store.enqueue({ ...request, job_id: 'unknown', idempotency_key: 'unknown' }, 1, 1002);
    const uncertain = store.claim(1, 'worker', 1002, 100)!;
    store.finish(uncertain.lease, 1003, { status: 'unknown' });
    store.enqueue({ ...request, job_id: 'waiting', idempotency_key: 'waiting', due_at: 5000 }, 1, 1003);
    expect(new JobRetentionController(store, { now: () => 2000 }, 1).prune(500)).toBe(1);
    expect(store.load('job-1')).toBeNull();
    expect(store.enqueue(request, 1, 2000)).toMatchObject({ duplicate: true, job_id: 'job-1', job: null });
    expect(() => store.enqueue({ ...request, payload: { changed: true } }, 1, 2000)).toThrow('冲突');
    expect(store.load('unknown')?.status).toBe('unknown');
    expect(store.load('waiting')?.status).toBe('queued');
    expect(() => store.enqueue({ ...request, idempotency_key: 'waiting', due_at: 5000 }, 1, 2000)).toThrow('不同工作');
  } finally { store.close(); }
});
