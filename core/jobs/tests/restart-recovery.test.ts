import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { JobRecoveryController, SqliteJobStore, type JobRequest, type JobTriggerDefinition } from '../src/index.js';

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
    unchanged.pragma('user_version=3');
  } finally { unchanged.close(); }
  expect(() => new SqliteJobStore(databasePath)).toThrow('schema version');
});

it('旧候选 v1 Jobs 库拒绝隐式升级，保留原 Job 和版本', () => {
  const databasePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-v1-')), 'jobs.sqlite');
  const store = new SqliteJobStore(databasePath);
  const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
  store.activateAuthority(1, 1000);
  store.enqueue(request, 1, 1000);
  store.close();
  const legacy = new Database(databasePath);
  try {
    legacy.exec('DROP TABLE job_trigger_occurrences; DROP TABLE job_triggers; PRAGMA user_version=1;');
  } finally { legacy.close(); }
  expect(() => new SqliteJobStore(databasePath)).toThrow('schema version');
  const preserved = new Database(databasePath);
  try {
    expect(preserved.pragma('user_version', { simple: true })).toBe(1);
    expect(preserved.prepare('SELECT job_id,status FROM jobs').get()).toEqual({ job_id: 'job-1', status: 'queued' });
  } finally { preserved.close(); }
});
