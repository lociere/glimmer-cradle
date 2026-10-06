import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { JobAuthorityError, JobRecoveryController, SqliteJobStore, type JobAttempt,
  type JobReconciliationEvidence, type JobReconciliationPort, type JobRequest, type JobTriggerDefinition } from '../src/index.js';

it('重开真实 SQLite 后恢复持久 attempt/backoff；非幂等 unknown 不自动重放', () => {
  const databasePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-restart-')), 'jobs.sqlite');
  let store = new SqliteJobStore(databasePath);
  const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
  store.activateAuthority(1, 1000);
  store.enqueue(request, 1, 1000);
  store.enqueue({ ...request, job_id: 'safe', idempotency_key: 'safe', retry_mode: 'idempotent' }, 1, 1000);
  store.enqueue({ ...request, job_id: 'exhausted', idempotency_key: 'exhausted', retry_mode: 'idempotent', max_attempts: 1 }, 1, 1000);
  expect(store.claim(1, 'crashed', 1000, 100)).not.toBeNull();
  expect(store.claim(1, 'crashed', 1000, 100)).not.toBeNull();
  expect(store.claim(1, 'crashed', 1000, 100)).not.toBeNull();
  store.close();
  store = new SqliteJobStore(databasePath);
  try {
    store.activateAuthority(1, 1050);
    const recovery = new JobRecoveryController(store, { now: () => 1100 }, 1, { base_delay_ms: 25, max_delay_ms: 100 });
    expect(recovery.recoverExpired()).toBe(3);
    expect(recovery.recoverExpired()).toBe(0);
    expect(store.load('job-1')).toMatchObject({ status: 'unknown', attempt: 1 });
    expect(store.load('safe')).toMatchObject({ status: 'retry_wait', attempt: 1, due_at: 1125 });
    expect(store.load('exhausted')?.status).toBe('dead_letter');
    const next = store.claim(1, 'restarted', 1125, 100)!;
    expect(next.job.job_id).toBe('safe');
    expect(next.job.attempt).toBe(2);
  } finally { store.close(); }
});

it.each(['all', 'latest'] as const)('周期 %s 补偿政策持久保存 checkpoint；重启/重复 tick 不重放', (catch_up) => {
  const databasePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-schedule-')), 'jobs.sqlite');
  let store = new SqliteJobStore(databasePath);
  const definition: JobTriggerDefinition = {
    trigger_id: 'periodic', scope_id: 'scope', goal_id: 'goal', kind: 'test.periodic', payload: {},
    retry_mode: 'idempotent', max_attempts: 3, schedule: { kind: 'interval', start_at: 1000, every_ms: 100, catch_up },
  };
  store.activateAuthority(1, 1000);
  store.registerTrigger(definition, 1, 1000);
  const first = store.materializeDue(1, 1250, 2);
  expect(first.map(value => value.job?.due_at)).toEqual(catch_up === 'all' ? [1000, 1100] : [1200]);
  store.close();
  store = new SqliteJobStore(databasePath);
  try {
    const rest = store.materializeDue(1, 1250, 2);
    expect(rest.map(value => value.job?.due_at)).toEqual(catch_up === 'all' ? [1200] : []);
    expect(store.loadTrigger('periodic')).toMatchObject({ next_due_at: 1300, last_due_at: 1200 });
    expect(store.materializeDue(1, 1250, 2)).toEqual([]);
    expect(store.materializeDue(1, 1300, 2).map(value => value.job?.due_at)).toEqual([1300]);
    expect(store.loadTrigger('periodic')?.next_due_at).toBe(1400);
  } finally { store.close(); }
});

it('数据库失败原子回滚已入队 Job、occurrence 与 next due，不丢失已过去的触发', () => {
  const databasePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-atomic-')), 'jobs.sqlite');
  const store = new SqliteJobStore(databasePath), injection = new Database(databasePath);
  try {
    store.activateAuthority(1, 1000);
    store.registerTrigger({ trigger_id: 'periodic', scope_id: 'scope', goal_id: 'goal', kind: 'test.periodic', payload: {},
      retry_mode: 'idempotent', max_attempts: 3, schedule: { kind: 'interval', start_at: 1000, every_ms: 100, catch_up: 'all' } }, 1, 1000);
    injection.exec(`CREATE TRIGGER reject_occurrence BEFORE INSERT ON job_trigger_occurrences
      WHEN NEW.occurrence_id='schedule:1100' BEGIN SELECT RAISE(ABORT,'injected occurrence failure'); END;`);
    expect(() => store.materializeDue(1, 1200, 3)).toThrow('injected occurrence failure');
    expect(injection.prepare('SELECT COUNT(*) AS count FROM jobs').get()).toEqual({ count: 0 });
    expect(injection.prepare('SELECT COUNT(*) AS count FROM job_trigger_occurrences').get()).toEqual({ count: 0 });
    expect(store.loadTrigger('periodic')).toMatchObject({ next_due_at: 1000, last_due_at: null, revision: 1 });
    injection.exec('DROP TRIGGER reject_occurrence');
    expect(store.materializeDue(1, 1200, 3).map(value => value.job?.due_at)).toEqual([1000, 1100, 1200]);
    expect(store.loadTrigger('periodic')?.next_due_at).toBe(1300);
  } finally { injection.close(); store.close(); }
});

it('两个真实进程竞争同一 durable schedule，仅生成一组稳定 occurrence', async () => {
  const databasePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-process-race-')), 'jobs.sqlite');
  const store = new SqliteJobStore(databasePath);
  store.activateAuthority(1, 1000);
  store.registerTrigger({ trigger_id: 'periodic', scope_id: 'scope', goal_id: 'goal', kind: 'test.periodic', payload: {},
    retry_mode: 'idempotent', max_attempts: 3, schedule: { kind: 'interval', start_at: 1000, every_ms: 100, catch_up: 'all' } }, 1, 1000);
  const entry = path.resolve(__dirname, '../dist/index.js');
  const script = `const {SqliteJobStore}=require(process.argv[1]);
    const store=new SqliteJobStore(process.argv[2]); process.send({ready:true});
    process.stdin.once('data',()=>{ try {
      const ids=store.materializeDue(1,1200,3).map(value=>value.job_id);
      store.close(); process.send({ids},()=>{process.disconnect();process.stdin.destroy();});
    } catch(error) {store.close();console.error(error);process.exitCode=1;process.disconnect();process.stdin.destroy();} });`;
  const contestants = [0, 1].map(() => {
    const child = spawn(process.execPath, ['-e', script, entry, databasePath], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    let ids: string[] = [], stderr = '';
    child.stderr!.on('data', chunk => { stderr += String(chunk); });
    const ready = new Promise<void>((resolve, reject) => {
      child.on('message', message => { if ((message as { ready?: boolean }).ready) resolve(); });
      child.on('error', reject);
      child.on('exit', code => { if (code !== 0) reject(new Error(`race fixture failed: ${stderr}`)); });
    });
    const done = new Promise<string[]>((resolve, reject) => {
      child.on('message', message => { if ((message as { ids?: string[] }).ids) ids = (message as { ids: string[] }).ids; });
      child.on('error', reject);
      child.on('exit', code => { if (code === 0) resolve(ids); else reject(new Error(`race fixture failed: ${stderr}`)); });
    });
    return { child, ready, done };
  });
  // 立即观察完成 Promise，启动失败不会遗留未处理 rejection。
  const completed = Promise.all(contestants.map(value => value.done));
  void completed.catch(() => undefined);
  try {
    await Promise.all(contestants.map(value => value.ready));
    for (const contestant of contestants) contestant.child.stdin!.end('go');
    const identities = (await completed).flat();
    expect(identities).toHaveLength(3);
    expect(new Set(identities).size).toBe(3);
    expect(store.loadTrigger('periodic')?.next_due_at).toBe(1300);
    expect(store.materializeDue(1, 1200, 3)).toEqual([]);
  } finally {
    for (const contestant of contestants) if (contestant.child.exitCode === null) contestant.child.kill();
    store.close();
  }
}, 15_000);

it('拒绝未知 schema 或其他 owner 的旧库，保留原表', () => {
  const databasePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-schema-')), 'jobs.sqlite');
  const foreign = new Database(databasePath);
  foreign.exec('CREATE TABLE original(value TEXT); INSERT INTO original VALUES(\'preserved\')');
  foreign.close();
  expect(() => new SqliteJobStore(databasePath)).toThrow('未知 Jobs 数据库');
  const unchanged = new Database(databasePath);
  try {
    expect(unchanged.prepare('SELECT value FROM original').get()).toEqual({ value: 'preserved' });
    unchanged.pragma('user_version=99');
  } finally { unchanged.close(); }
  expect(() => new SqliteJobStore(databasePath)).toThrow('schema version');
});

it.each([1, 2, 3])('旧候选 v%s Jobs 库拒绝隐式升级，保留原 Job 和版本', (version) => {
  const databasePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-v1-')), 'jobs.sqlite');
  const store = new SqliteJobStore(databasePath);
  const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
  store.activateAuthority(1, 1000);
  store.enqueue(request, 1, 1000);
  store.close();
  const legacy = new Database(databasePath);
  try {
    legacy.exec('DROP TABLE job_source_receipts;');
    if (version < 3) legacy.exec('DROP TABLE job_outbox; DROP TABLE job_reconciliations; DROP TABLE job_attempts;');
    if (version === 1) legacy.exec('DROP TABLE job_trigger_occurrences; DROP TABLE job_triggers;');
    legacy.pragma(`user_version=${version}`);
  } finally { legacy.close(); }
  expect(() => new SqliteJobStore(databasePath)).toThrow('schema version');
  const preserved = new Database(databasePath);
  try {
    expect(preserved.pragma('user_version', { simple: true })).toBe(version);
    expect(preserved.prepare('SELECT job_id,status FROM jobs').get()).toEqual({ job_id: 'job-1', status: 'queued' });
  } finally { preserved.close(); }
});

const recoveryPolicy = { base_delay_ms: 25, max_delay_ms: 100 };
function requestFixture(): JobRequest {
  return JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
}
function evidenceFor(attempt: JobAttempt, scopeId: string, observedAt: number): JobReconciliationEvidence {
  return { job_id: attempt.job_id, attempt: attempt.attempt, authority_epoch: attempt.authority_epoch,
    fencing_token: attempt.fencing_token, owner_id: attempt.owner_id, scope_id: scopeId,
    source_id: 'target-owner', evidence_id: `receipt-${attempt.attempt}`, observed_at: observedAt,
    resolution: 'applied', result: { committed: true } };
}

it('独立目标库业务/receipt 已提交而 Jobs 完成 ACK 丢失，重启查询原 attempt 后确认成功且不重放', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-cross-store-'));
  const databasePath = path.join(directory, 'jobs.sqlite');
  let store = new SqliteJobStore(databasePath);
  let target = new Database(path.join(directory, 'target.sqlite'));
  const request = requestFixture();
  target.exec(`CREATE TABLE business(value INTEGER NOT NULL); INSERT INTO business VALUES(0);
    CREATE TABLE receipts(job_id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, evidence_json TEXT NOT NULL);`);
  store.activateAuthority(1, 1000);
  store.enqueue(request, 1, 1000);
  const claim = store.claim(1, 'original-worker', 1000, 100)!;
  const original = store.listAttempts(request.job_id)[0];
  const evidence = evidenceFor(original, request.scope_id, 1001);
  target.transaction(() => {
    target.prepare('UPDATE business SET value=value+1').run();
    target.prepare('INSERT INTO receipts VALUES(?,?,?)').run(request.job_id, request.scope_id, JSON.stringify(evidence));
  }).immediate();
  // 接收方提交之后崩溃，Jobs 的 finish 从未被确认；两个库分别关闭并重开。
  store.close(); target.close();
  store = new SqliteJobStore(databasePath);
  target = new Database(path.join(directory, 'target.sqlite'));
  try {
    store.activateAuthority(2, 1100);
    expect(store.listAttempts(request.job_id)[0]).toMatchObject({ ...original, status: 'unknown', finished_at: 1100, error_code: 'authority_changed' });
    expect(store.load(request.job_id)?.fencing_token).toBeGreaterThan(original.fencing_token);
    const port: JobReconciliationPort = { kind: request.kind, async query(job, attempt) {
      expect(attempt.authority_epoch).toBe(1);
      const receipt = target.prepare('SELECT evidence_json FROM receipts WHERE job_id=? AND scope_id=?')
        .get(job.job_id, job.scope_id) as { evidence_json: string };
      return JSON.parse(receipt.evidence_json) as JobReconciliationEvidence;
    } };
    const recovery = new JobRecoveryController(store, { now: () => 1101 }, 2, recoveryPolicy);
    expect(await recovery.reconcile(request.job_id, port)).toMatchObject({ status: 'accepted', job: { status: 'succeeded', attempt: 1, result: { committed: true } } });
    expect(store.finish(claim.lease, 1102, { status: 'succeeded', result: { late: true } })).toBe(false);
    expect(store.claim(2, 'new-worker', 1102, 100)).toBeNull();
    expect(target.prepare('SELECT value FROM business').get()).toEqual({ value: 1 });
    expect(store.reconcile(evidence, 2, 3, 1102, recoveryPolicy).status).toBe('duplicate');
    expect(() => store.reconcile({ ...evidence, observed_at: 1002 }, 2, 3, 1102, recoveryPolicy)).toThrow('内容冲突');
    expect(store.listAttempts(request.job_id)[0]).toMatchObject({ status: 'succeeded', authority_epoch: 1, fencing_token: original.fencing_token });
  } finally { target.close(); store.close(); }
});

it.each([1, 3])('not-applied 必须由接收 owner 封口；attempt 上限 %s 决定安全重试或 dead letter', async (maxAttempts) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-sealed-attempt-'));
  const store = new SqliteJobStore(path.join(directory, 'jobs.sqlite'));
  const target = new Database(path.join(directory, 'target.sqlite'));
  const request = { ...requestFixture(), max_attempts: maxAttempts };
  target.exec(`CREATE TABLE fences(job_id TEXT NOT NULL,attempt INTEGER NOT NULL,PRIMARY KEY(job_id,attempt));
    CREATE TABLE business(job_id TEXT PRIMARY KEY, attempt INTEGER NOT NULL);`);
  try {
    store.activateAuthority(1, 1000); store.enqueue(request, 1, 1000);
    store.claim(1, 'old-worker', 1000, 100);
    store.recoverExpired(1, 1100, recoveryPolicy);
    const port: JobReconciliationPort = { kind: request.kind, async query(job, attempt) {
      return target.transaction(() => {
        target.prepare('INSERT OR IGNORE INTO fences VALUES(?,?)').run(job.job_id, attempt.attempt);
        expect(target.prepare('SELECT job_id FROM business WHERE job_id=?').get(job.job_id)).toBeUndefined();
        return { ...evidenceFor(attempt, job.scope_id, 1100), resolution: 'not_applied', receiver_fenced: true } as JobReconciliationEvidence;
      }).immediate();
    } };
    const recovery = new JobRecoveryController(store, { now: () => 1100 }, 1, recoveryPolicy);
    expect(await recovery.reconcile(request.job_id, port)).toMatchObject({ status: 'accepted', job: { status: maxAttempts === 1 ? 'dead_letter' : 'retry_wait' } });
    const commit = target.transaction((attempt: number) => {
      if (target.prepare('SELECT 1 FROM fences WHERE job_id=? AND attempt=?').get(request.job_id, attempt)) throw new Error('receiver fenced');
      target.prepare('INSERT INTO business VALUES(?,?)').run(request.job_id, attempt);
    });
    expect(() => commit.immediate(1)).toThrow('receiver fenced');
    const next = store.claim(1, 'new-worker', 1125, 100);
    if (maxAttempts === 1) expect(next).toBeNull();
    else {
      expect(next!.job.attempt).toBe(2);
      commit.immediate(2);
      expect(store.finish(next!.lease, 1126, { status: 'succeeded', result: {} })).toBe(true);
      expect(target.prepare('SELECT attempt FROM business').get()).toEqual({ attempt: 2 });
    }
  } finally { target.close(); store.close(); }
});

it('查询无证据/失败/取消/错 owner 均不重放 unknown；证据错 scope、身份、时间与未封口被拒绝', async () => {
  const store = new SqliteJobStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-proof-')), 'jobs.sqlite'));
  const request = requestFixture();
  try {
    store.activateAuthority(1, 1000); store.enqueue(request, 1, 1000); store.claim(1, 'worker', 1000, 100);
    store.recoverExpired(1, 1100, recoveryPolicy);
    const job = store.load(request.job_id)!;
    const evidence = evidenceFor(store.listAttempts(request.job_id)[0], request.scope_id, 1100);
    const recovery = new JobRecoveryController(store, { now: () => 1100 }, 1, recoveryPolicy);
    expect(await recovery.reconcile(request.job_id, { kind: request.kind, async query() { return null; } })).toMatchObject({ status: 'unavailable' });
    await expect(recovery.reconcile(request.job_id, { kind: request.kind, async query() { throw new Error('query failed'); } })).rejects.toThrow('query failed');
    await expect(recovery.reconcile(request.job_id, { kind: 'wrong', async query() { return evidence; } })).rejects.toThrow('owner');
    const cancellation = new AbortController();
    await expect(recovery.reconcile(request.job_id, { kind: request.kind, async query() { cancellation.abort(); return evidence; } }, cancellation.signal)).rejects.toThrow();
    for (const invalid of [{ job_id: 'another' }, { scope_id: 'other' }, { attempt: 2 }, { authority_epoch: 2 },
      { fencing_token: 2 }, { owner_id: 'other' }, { observed_at: 999 }, { observed_at: 1101 },
      { resolution: 'not_applied', receiver_fenced: false }, { resolution: 'failed', error_code: 'secret raw text' },
      { resolution: 'applied', result: [] }]) {
      await expect(recovery.reconcile(request.job_id, { kind: request.kind,
        async query() { return { ...evidence, ...invalid } as JobReconciliationEvidence; } })).rejects.toThrow();
    }
    expect(store.load(request.job_id)).toEqual(job);
    expect(store.claim(1, 'replacement', 1100, 100)).toBeNull();
  } finally { store.close(); }
});

it('查询期间切代/另一查询已提交时旧证据晚到不能覆盖；已接纳旧证据不解决新 unknown attempt', async () => {
  const store = new SqliteJobStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-late-proof-')), 'jobs.sqlite'));
  const request = requestFixture();
  try {
    store.activateAuthority(1, 1000); store.enqueue(request, 1, 1000); store.claim(1, 'worker', 1000, 100);
    store.recoverExpired(1, 1100, recoveryPolicy);
    const first = store.listAttempts(request.job_id)[0];
    const evidence: JobReconciliationEvidence = { ...evidenceFor(first, request.scope_id, 1100), resolution: 'not_applied', receiver_fenced: true };
    const recovery = new JobRecoveryController(store, { now: () => 1100 }, 1, recoveryPolicy);
    await expect(recovery.reconcile(request.job_id, { kind: request.kind, async query() {
      store.activateAuthority(2, 1100); return evidence;
    } })).rejects.toThrow(JobAuthorityError);
    const current = store.load(request.job_id)!;
    expect(store.reconcile(evidence, 2, current.revision - 1, 1100, recoveryPolicy).status).toBe('stale');
    expect(store.reconcile(evidence, 2, current.revision, 1100, recoveryPolicy).status).toBe('accepted');
    store.claim(2, 'replacement', 1125, 100); store.recoverExpired(2, 1225, recoveryPolicy);
    const second = store.load(request.job_id)!;
    expect(store.reconcile(evidence, 2, second.revision, 1225, recoveryPolicy).status).toBe('duplicate');
    expect(store.load(request.job_id)).toEqual(second);
    expect(() => store.reconcile({ ...evidence, evidence_id: 'new-but-old-attempt' }, 2, second.revision, 1225, recoveryPolicy)).toThrow('attempt');
    const failure: JobReconciliationEvidence = { ...evidenceFor(store.listAttempts(request.job_id)[1], request.scope_id, 1225),
      resolution: 'failed', error_code: 'receiver_rejected' };
    expect(store.reconcile(failure, 2, second.revision, 1225, recoveryPolicy)).toMatchObject({ status: 'accepted', job: { status: 'dead_letter' } });
    expect(store.reconcile({ ...failure, evidence_id: 'late-query' }, 2, second.revision, 1225, recoveryPolicy).status).toBe('stale');
  } finally { store.close(); }
});

it('outbox/对账审计写失败时，Job 状态、attempt 与证据确认全部原子回滚', () => {
  const databasePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-state-atomic-')), 'jobs.sqlite');
  const store = new SqliteJobStore(databasePath), injection = new Database(databasePath);
  const request = requestFixture();
  try {
    store.activateAuthority(1, 1000); store.enqueue(request, 1, 1000);
    injection.exec("CREATE TRIGGER reject_state BEFORE INSERT ON job_outbox BEGIN SELECT RAISE(ABORT,'injected outbox failure'); END;");
    expect(() => store.claim(1, 'worker', 1000, 100)).toThrow('injected outbox failure');
    expect(store.load(request.job_id)).toMatchObject({ status: 'queued', attempt: 0 });
    expect(store.listAttempts(request.job_id)).toEqual([]);
    injection.exec('DROP TRIGGER reject_state');
    const claim = store.claim(1, 'worker', 1000, 100)!;
    const running = store.load(request.job_id)!;
    const attempts = store.listAttempts(request.job_id);
    injection.exec("CREATE TRIGGER reject_state BEFORE INSERT ON job_outbox BEGIN SELECT RAISE(ABORT,'injected outbox failure'); END;");
    expect(() => store.finish(claim.lease, 1001, { status: 'succeeded', result: {} })).toThrow('injected outbox failure');
    expect(store.load(request.job_id)).toEqual(running); expect(store.listAttempts(request.job_id)).toEqual(attempts);
    expect(() => store.enqueue({ ...request, job_id: 'failed', idempotency_key: 'failed' }, 1, 1001)).toThrow('injected outbox failure');
    expect(store.load('failed')).toBeNull();
    expect(() => store.activateAuthority(2, 1001)).toThrow('injected outbox failure');
    expect(store.isLeaseCurrent(claim.lease, 1001)).toBe(true);
    expect(() => store.cancel(request.job_id, 1, running.revision, 1001)).toThrow('injected outbox failure');
    expect(() => store.recoverExpired(1, 1100, recoveryPolicy)).toThrow('injected outbox failure');
    expect(store.load(request.job_id)).toEqual(running); expect(store.listAttempts(request.job_id)).toEqual(attempts);
    injection.exec('DROP TRIGGER reject_state');
    store.recoverExpired(1, 1100, recoveryPolicy);
    const unknown = store.load(request.job_id)!;
    const evidence = evidenceFor(store.listAttempts(request.job_id)[0], request.scope_id, 1100);
    injection.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON job_reconciliations BEGIN SELECT RAISE(ABORT,'injected audit failure'); END;");
    expect(() => store.reconcile(evidence, 1, unknown.revision, 1100, recoveryPolicy)).toThrow('injected audit failure');
    expect(store.load(request.job_id)).toEqual(unknown); expect(store.listAttempts(request.job_id)[0].status).toBe('unknown');
    injection.exec('DROP TRIGGER reject_audit');
    injection.exec("CREATE TRIGGER reject_state BEFORE INSERT ON job_outbox BEGIN SELECT RAISE(ABORT,'injected outbox failure'); END;");
    expect(() => store.reconcile(evidence, 1, unknown.revision, 1100, recoveryPolicy)).toThrow('injected outbox failure');
    expect(injection.prepare('SELECT COUNT(*) AS count FROM job_reconciliations').get()).toEqual({ count: 0 });
    injection.exec('DROP TRIGGER reject_state');
    expect(store.reconcile(evidence, 1, unknown.revision, 1100, recoveryPolicy).status).toBe('accepted');
    expect(store.readOutbox(1, 100).map(event => event.status)).toEqual(['queued', 'running', 'unknown', 'succeeded']);
  } finally { injection.close(); store.close(); }
});
