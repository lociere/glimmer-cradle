import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { JobAuthorityError, JobController, JobRecoveryController, JobRetentionController, SqliteJobStore,
  type JobRequest, type JobStateEvent, type JobStateReceiverPort } from '../src/index.js';

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
    expect(store.listAttempts(request.job_id)[0]).toMatchObject({ status: 'cancelled', owner_id: 'worker-1' });
  } finally { release(); await controller.stop(); store.close(); }
});

it('真实接收 SQLite inbox/业务提交后 ACK 丢失，重启重投不重复业务变化，未投递事实阻止 retention', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-outbox-'));
  const jobsPath = path.join(directory, 'jobs.sqlite');
  const targetPath = path.join(directory, 'receiver.sqlite');
  let store = new SqliteJobStore(jobsPath), target = new Database(targetPath);
  const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
  target.exec(`CREATE TABLE inbox(event_id TEXT PRIMARY KEY,document TEXT NOT NULL);
    CREATE TABLE business(job_id TEXT PRIMARY KEY,completion_count INTEGER NOT NULL);`);
  let loseAck = true;
  let failureEvent!: JobStateEvent;
  const accept = (event: JobStateEvent) => target.transaction(() => {
    const document = JSON.stringify(event);
    const existing = target.prepare('SELECT document FROM inbox WHERE event_id=?').get(event.event_id) as { document: string } | undefined;
    if (existing) { if (existing.document !== document) throw new Error('inbox conflict'); return; }
    target.prepare('INSERT INTO inbox VALUES(?,?)').run(event.event_id, document);
    if (event.status === 'succeeded') target.prepare(`INSERT INTO business VALUES(?,1)
      ON CONFLICT(job_id) DO UPDATE SET completion_count=completion_count+1`).run(event.job_id);
  }).immediate();
  const receiver: JobStateReceiverPort = { async accept(event) {
    accept(event);
    if (loseAck && event.status === 'succeeded') { failureEvent = event; throw new Error('ACK lost after receiver commit'); }
    return { event_id: event.event_id, accepted: true };
  } };
  try {
    store.activateAuthority(1, 1000); store.enqueue(request, 1, 1000);
    const claim = store.claim(1, 'worker', 1000, 100)!;
    store.finish(claim.lease, 1001, { status: 'succeeded', result: { completed: true } });
    let recovery = new JobRecoveryController(store, { now: () => 2000 }, 1, { base_delay_ms: 25, max_delay_ms: 100 });
    target.exec("CREATE TRIGGER reject_business BEFORE INSERT ON business BEGIN SELECT RAISE(ABORT,'injected receiver failure'); END;");
    await expect(recovery.deliverOutbox(receiver, 100)).rejects.toThrow('injected receiver failure');
    expect(target.prepare('SELECT COUNT(*) AS count FROM inbox').get()).toEqual({ count: 2 });
    expect(target.prepare('SELECT job_id FROM business').get()).toBeUndefined();
    expect(store.readOutbox(1, 100).map(event => event.status)).toEqual(['succeeded']);
    target.exec('DROP TRIGGER reject_business');
    await expect(recovery.deliverOutbox(receiver, 100)).rejects.toThrow('ACK lost');
    expect(store.readOutbox(1, 100)).toEqual([failureEvent]);
    expect(new JobRetentionController(store, { now: () => 2000 }, 1).prune(500)).toBe(0);
    expect(target.prepare('SELECT completion_count FROM business').get()).toEqual({ completion_count: 1 });
    store.close(); target.close();
    store = new SqliteJobStore(jobsPath); target = new Database(targetPath); loseAck = false;
    recovery = new JobRecoveryController(store, { now: () => 2000 }, 1, { base_delay_ms: 25, max_delay_ms: 100 });
    expect(await recovery.deliverOutbox(receiver, 100)).toBe(1);
    expect(await recovery.deliverOutbox(receiver, 100)).toBe(0);
    expect(target.prepare('SELECT completion_count FROM business').get()).toEqual({ completion_count: 1 });
    expect(target.prepare('SELECT COUNT(*) AS count FROM inbox').get()).toEqual({ count: 3 });
    expect(store.acknowledgeOutbox(failureEvent.event_id, 1, 2000)).toBe(true);
    expect(new JobRetentionController(store, { now: () => 2000 }, 1).prune(500)).toBe(1);
    expect(store.readOutbox(1, 100)).toEqual([]);
    expect(store.listAttempts(request.job_id)[0].status).toBe('succeeded');
    expect(store.enqueue(request, 1, 2000)).toMatchObject({ duplicate: true, job: null });
  } finally { target.close(); store.close(); }
});

it('接收失败/伪造确认/投递取消/切代不 ACK；旧 authority 不能读取或确认 outbox', async () => {
  const store = new SqliteJobStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-outbox-fencing-')), 'jobs.sqlite'));
  const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
  try {
    store.activateAuthority(1, 1000); store.enqueue(request, 1, 1000);
    const original = store.readOutbox(1, 10);
    const recovery = new JobRecoveryController(store, { now: () => 1001 }, 1, { base_delay_ms: 25, max_delay_ms: 100 });
    await expect(recovery.deliverOutbox({ async accept() { throw new Error('receiver failed'); } }, 10)).rejects.toThrow('receiver failed');
    await expect(recovery.deliverOutbox({ async accept() { return { event_id: 'wrong', accepted: true }; } }, 10)).rejects.toThrow('不匹配');
    const cancellation = new AbortController();
    await expect(recovery.deliverOutbox({ async accept(event) { cancellation.abort(); return { event_id: event.event_id, accepted: true }; } }, 10,
      cancellation.signal)).rejects.toThrow();
    expect(store.readOutbox(1, 10)).toEqual(original);
    expect(() => store.readOutbox(1, 0)).toThrow('limit');
    expect(() => store.acknowledgeOutbox(original[0].event_id, 1, 999)).toThrow('时间');
    expect(store.acknowledgeOutbox('missing', 1, 1001)).toBe(false);
    await expect(recovery.deliverOutbox({ async accept(event) {
      store.activateAuthority(2, 1001); return { event_id: event.event_id, accepted: true };
    } }, 10)).rejects.toThrow(JobAuthorityError);
    expect(() => store.readOutbox(1, 10)).toThrow(JobAuthorityError);
    expect(() => store.acknowledgeOutbox(original[0].event_id, 1, 1002)).toThrow(JobAuthorityError);
    expect(store.readOutbox(2, 10).map(value => value.status)).toEqual(['queued', 'queued']);
  } finally { store.close(); }
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
    expect(new JobRetentionController(store, { now: () => 2000 }, 1).prune(500)).toBe(0);
    for (const event of store.readOutbox(1, 100)) store.acknowledgeOutbox(event.event_id, 1, 2000);
    expect(new JobRetentionController(store, { now: () => 2000 }, 1).prune(500)).toBe(1);
    expect(store.load('job-1')).toBeNull();
    expect(store.enqueue(request, 1, 2000)).toMatchObject({ duplicate: true, job_id: 'job-1', job: null });
    expect(() => store.enqueue({ ...request, payload: { changed: true } }, 1, 2000)).toThrow('冲突');
    expect(store.load('unknown')?.status).toBe('unknown');
    expect(store.load('waiting')?.status).toBe('queued');
    expect(() => store.enqueue({ ...request, idempotency_key: 'waiting', due_at: 5000 }, 1, 2000)).toThrow('不同工作');
  } finally { store.close(); }
});
