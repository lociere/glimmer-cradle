import { expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobController, JobScheduler, SqliteJobStore, copyJobStoreForAdmissionOrderMigration, type JobRequest } from '../src/index.js';

const fixture = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
const records = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/jobs-v4-records.json'), 'utf8')) as {
  rows: Record<string, Record<string, unknown>[]>;
};
const clock = { now: () => 1000 }, policy = { base_delay_ms: 1, max_delay_ms: 10 };
const request = (id: string): JobRequest => ({ ...fixture, job_id: id, idempotency_key: id });
const root = (): string => mkdtempSync(path.join(os.tmpdir(), 'glimmer-jobs-admission-order-'));
function legacy(file: string, populated = true): void {
  const db = new Database(file);
  try {
    db.exec(readFileSync(path.resolve(__dirname, '../migrations/000-jobs-v4.sql'), 'utf8'));
    if (populated) db.transaction(() => {
      for (const [table, rows] of Object.entries(records.rows)) for (const row of rows) {
        const columns = Object.keys(row);
        db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...Object.values(row));
      }
    }).immediate();
  } finally { db.close(); }
}
function originalRows(file: string): Record<string, unknown[]> {
  const db = new Database(file, { readonly: true });
  try {
    return Object.fromEntries(Object.keys(records.rows).map(table => {
      const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
      const original = rows.map(row => { const { enqueue_sequence: _sequence, ...value } = row; return value; });
      return [table, original.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))];
    }));
  } finally { db.close(); }
}

it('任意长度ID与同钟持续区间插入不延长本轮，原等待Job按入队顺序接纳且无提前attempt', async () => {
  const file = path.join(root(), 'jobs.sqlite'), store = new SqliteJobStore(file), producer = new SqliteJobStore(file);
  const controller = new JobController(store, clock, policy), checked: string[] = [], executed: string[] = [];
  let eligible = false;
  try {
    store.activateAuthority(1, 1000);
    for (const id of ['a', 'b']) producer.enqueue(request(id), 1, 1000);
    controller.register({ kind: fixture.kind, retry_mode: fixture.retry_mode, async execute(context) {
      executed.push(context.job.job_id); return { status: 'succeeded', result: {} };
    } });
    const scheduler = new JobScheduler(store, controller, clock, 1, 'host', 100, fixture.kind,
      { kind: fixture.kind, async isEligible(job) { checked.push(job.job_id); return eligible; } });
    expect(await scheduler.runDue(1)).toBe(0);
    producer.enqueue(request('a0'), 1, 1000); // a < a0 < b；旧按ID区间的扫描会被这些新增挤占。
    expect(await scheduler.runDue(1)).toBe(0);
    expect(checked).toEqual(['a', 'b']);
    eligible = true;
    for (const [index, id] of ['a00', 'a000'].entries()) {
      producer.enqueue(request(id), 1, 500); // 回拨和同钟均不能进入已经固定的接纳序号区间。
      expect(await scheduler.runDue(1)).toBe(1);
      expect(executed[index]).toBe(index === 0 ? 'a' : 'b');
    }
    expect(executed).toEqual(['a', 'b']);
    expect(store.load('a0')).toMatchObject({ status: 'queued', attempt: 0 });
    expect(store.listAttempts('a')).toHaveLength(1);
    expect(store.load('a')).not.toHaveProperty('enqueue_sequence');
    expect(store.listProjection(1, fixture.scope_id, 100).every(job => !('enqueue_sequence' in job))).toBe(true);
    expect(store.readOutbox(1, 100).every(event => !('enqueue_sequence' in event))).toBe(true);
  } finally { await controller.stop(); store.close(); producer.close(); }
});

it('清理最高序号/重开/ROWID复用及墙钟回退不复用接纳序号，不让新Job延长旧轮', async () => {
  const file = path.join(root(), 'jobs.sqlite'), store = new SqliteJobStore(file);
  let producer = new SqliteJobStore(file);
  const controller = new JobController(store, clock, policy), checked: string[] = [];
  let eligible = false;
  try {
    store.activateAuthority(1, 1000);
    for (const id of ['a', 'm']) producer.enqueue(request(id), 1, 1000);
    controller.register({ kind: fixture.kind, retry_mode: fixture.retry_mode, async execute() { return { status: 'succeeded', result: {} }; } });
    const scheduler = new JobScheduler(store, controller, clock, 1, 'host', 100, fixture.kind,
      { kind: fixture.kind, async isEligible(job) { checked.push(job.job_id); return eligible; } });
    expect(await scheduler.runDue(1)).toBe(0);
    producer.cancel('m', 1, producer.load('m')!.revision, 1001);
    for (const event of producer.readOutbox(1, 100)) if (event.job_id === 'm') producer.acknowledgeOutbox(event.event_id, 1, 1001);
    expect(producer.pruneTerminal(1, 1002)).toBe(1);
    producer.close(); producer = new SqliteJobStore(file);
    producer.enqueue(request('a0'), 1, 500);
    const db = new Database(file, { readonly: true });
    try {
      expect(db.prepare('SELECT rowid,enqueue_sequence FROM jobs WHERE job_id=?').get('a0')).toEqual({ rowid: 2, enqueue_sequence: 3 });
      expect(db.prepare('SELECT last_sequence FROM job_enqueue_sequence').get()).toEqual({ last_sequence: 3 });
    } finally { db.close(); }
    expect(await scheduler.runDue(1)).toBe(0); // 原边界已删除，读空页回绕，不能跨到新seq3。
    eligible = true;
    expect(await scheduler.runDue(1)).toBe(1); expect(checked).toEqual(['a', 'a']);
    expect(store.load('a0')).toMatchObject({ attempt: 0, status: 'queued' });
  } finally { await controller.stop(); store.close(); producer.close(); }
});

it('源接纳/outbox失败回滚序号，重复/冲突不分配，安全整数耗尽失败关闭', () => {
  const file = path.join(root(), 'jobs.sqlite'), store = new SqliteJobStore(file), db = new Database(file);
  const source = { source_id: 'fixture.source', source_request_id: 'original', input_digest: 'a'.repeat(64) };
  try {
    store.activateAuthority(1, 1000);
    db.exec("CREATE TRIGGER fail_source BEFORE INSERT ON job_source_receipts BEGIN SELECT RAISE(ABORT,'source failure'); END");
    expect(() => store.enqueueSource(source, request('a'), 1, 1000)).toThrow('source failure');
    expect(db.prepare('SELECT last_sequence FROM job_enqueue_sequence').get()).toEqual({ last_sequence: 0 });
    expect(store.load('a')).toBeNull();
    db.exec('DROP TRIGGER fail_source');
    store.enqueueSource(source, request('a'), 1, 1000);
    expect(store.enqueueSource(source, { ...request('a'), max_attempts: 9 }, 1, 2000).duplicate).toBe(true);
    expect(() => store.enqueue({ ...request('a'), payload: { changed: true } }, 1, 1000)).toThrow();
    expect(db.prepare('SELECT last_sequence FROM job_enqueue_sequence').get()).toEqual({ last_sequence: 1 });
    db.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON job_outbox BEGIN SELECT RAISE(ABORT,'outbox failure'); END");
    expect(() => store.enqueue(request('b'), 1, 1000)).toThrow('outbox failure');
    expect(store.load('b')).toBeNull();
    expect(db.prepare('SELECT last_sequence FROM job_enqueue_sequence').get()).toEqual({ last_sequence: 1 });
    db.exec('DROP TRIGGER fail_outbox');
    db.prepare('UPDATE job_enqueue_sequence SET last_sequence=?').run(Number.MAX_SAFE_INTEGER);
    expect(() => store.enqueue(request('b'), 1, 1000)).toThrow('耗尽或损坏');
    expect(store.load('b')).toBeNull();
    expect(db.prepare('SELECT last_sequence FROM job_enqueue_sequence').get()).toEqual({ last_sequence: Number.MAX_SAFE_INTEGER });
  } finally { db.close(); store.close(); }
});

it.each([false, true])('v4隔离复制迁移 populated=%s：所有原恢复事实不变、源保留可恢复、候选schema与fresh一致', async populated => {
  const directory = root(), source = path.join(directory, 'v4.sqlite'), candidate = path.join(directory, 'v5.sqlite');
  legacy(source, populated);
  const before = originalRows(source), hash = createHash('sha256').update(readFileSync(source)).digest('hex');
  expect(() => new SqliteJobStore(source)).toThrow('受控迁移');
  await copyJobStoreForAdmissionOrderMigration(source, candidate);
  expect(originalRows(source)).toEqual(before); expect(originalRows(candidate)).toEqual(before);
  expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(hash);
  const store = new SqliteJobStore(candidate), freshPath = path.join(directory, 'fresh.sqlite'), fresh = new SqliteJobStore(freshPath);
  const db = new Database(candidate, { readonly: true }), empty = new Database(freshPath, { readonly: true });
  try {
    expect(db.pragma('user_version', { simple: true })).toBe(5);
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='jobs'").get())
      .toEqual(empty.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='jobs'").get());
    expect(db.pragma('table_info(jobs)')).toEqual(empty.pragma('table_info(jobs)'));
    const size = populated ? records.rows.jobs.length : 0;
    expect(db.prepare('SELECT last_sequence FROM job_enqueue_sequence').get()).toEqual({ last_sequence: size });
    expect(db.prepare('SELECT enqueue_sequence FROM jobs ORDER BY enqueue_sequence').all()).toEqual(Array.from({ length: size }, (_, index) => ({ enqueue_sequence: index + 1 })));
    store.activateAuthority(populated ? 2 : 1, 3000);
    store.enqueue(request('new-after-migration'), populated ? 2 : 1, 1000);
    expect(db.prepare('SELECT enqueue_sequence FROM jobs WHERE job_id=?').get('new-after-migration')).toEqual({ enqueue_sequence: size + 1 });
  } finally { db.close(); empty.close(); store.close(); fresh.close(); }
  await expect(copyJobStoreForAdmissionOrderMigration(source, candidate)).rejects.toThrow();
  const retry = path.join(directory, 'retry.sqlite'); await copyJobStoreForAdmissionOrderMigration(source, retry);
  expect(originalRows(retry)).toEqual(before);
  // 恢复来源仍是原 v4：重开查询原状态，不通过逆算新序号重新分配原身份。
  const restored = new Database(source, { readonly: true });
  try { expect(restored.pragma('user_version', { simple: true })).toBe(4); } finally { restored.close(); }
});

it('编译后Jobs迁移入口使用随制品migrations的v4/v5原schema与脚本，不依赖测试目录', async () => {
  const directory = root(), source = path.join(directory, 'original.sqlite'), candidate = path.join(directory, 'compiled-candidate.sqlite');
  legacy(source);
  const compiled = require('../dist/index.js') as { copyJobStoreForAdmissionOrderMigration: typeof copyJobStoreForAdmissionOrderMigration };
  expect(compiled.copyJobStoreForAdmissionOrderMigration.length).toBe(2);
  await compiled.copyJobStoreForAdmissionOrderMigration(source, candidate);
  expect(originalRows(candidate)).toEqual(originalRows(source));
});

it('迁移SQL中途失败回滚候选，源完好；同候选不得重跑覆盖，使用新路径恢复', async () => {
  const directory = root(), source = path.join(directory, 'v4.sqlite'), candidate = path.join(directory, 'failed.sqlite');
  legacy(source); const before = originalRows(source), execute = Database.prototype.exec;
  const failure = vi.spyOn(Database.prototype, 'exec').mockImplementation(function(this: Database.Database, sql: string) {
    if (sql.includes('ALTER TABLE jobs RENAME TO jobs_v4')) {
      execute.call(this, 'ALTER TABLE jobs ADD COLUMN injected INTEGER; PRAGMA user_version=5;');
      throw new Error('injected migration failure');
    }
    return execute.call(this, sql);
  });
  try { await expect(copyJobStoreForAdmissionOrderMigration(source, candidate)).rejects.toThrow('injected migration failure'); }
  finally { failure.mockRestore(); }
  expect(originalRows(source)).toEqual(before); expect(originalRows(candidate)).toEqual(before);
  const db = new Database(candidate, { readonly: true });
  try {
    expect(db.pragma('user_version', { simple: true })).toBe(4);
    expect((db.pragma('table_info(jobs)') as { name: string }[]).some(column => column.name === 'injected')).toBe(false);
  } finally { db.close(); }
  await expect(copyJobStoreForAdmissionOrderMigration(source, candidate)).rejects.toThrow();
  await copyJobStoreForAdmissionOrderMigration(source, path.join(directory, 'recovered.sqlite'));
  expect(originalRows(source)).toEqual(before);
});

it('停写但未checkpoint的真实WAL提交进入一致复制候选，不靠仅复制主库文件恢复', async () => {
  const directory = root(), source = path.join(directory, 'v4-wal.sqlite'), candidate = path.join(directory, 'v5.sqlite');
  legacy(source);
  const writer = new Database(source);
  try {
    writer.pragma('journal_mode=WAL'); writer.pragma('wal_autocheckpoint=0');
    writer.exec("UPDATE job_triggers SET enabled=0,revision=revision+1,updated_at=4000 WHERE trigger_id='original-trigger'");
    expect(existsSync(source + '-wal')).toBe(true);
    expect(readFileSync(source + '-wal').length).toBeGreaterThan(32);
    // 连接保留以防自动checkpoint；此后不再写，直至迁移完成，符合停写前置条件。
    const before = originalRows(source);
    await copyJobStoreForAdmissionOrderMigration(source, candidate);
    expect(originalRows(candidate)).toEqual(before);
    expect(originalRows(source)).toEqual(before);
    const copied = new Database(candidate, { readonly: true });
    try { expect(copied.prepare('SELECT enabled,revision FROM job_triggers').get()).toEqual({ enabled: 0, revision: 2 }); }
    finally { copied.close(); }
  } finally { writer.close(); }
});

it('真实另一连接在backup后提交，迁移拒绝过期候选，源保留新事实，停写后新路径重试', async () => {
  const directory = root(), source = path.join(directory, 'v4.sqlite'), candidate = path.join(directory, 'stale.sqlite');
  legacy(source);
  const backup = Database.prototype.backup;
  const loss = vi.spyOn(Database.prototype, 'backup').mockImplementation(async function(this: Database.Database, ...args: Parameters<typeof backup>) {
    const result = await backup.apply(this, args);
    const writer = new Database(source);
    try { writer.exec("UPDATE job_triggers SET enabled=0,revision=revision+1,updated_at=3000 WHERE trigger_id='original-trigger'"); }
    finally { writer.close(); }
    return result;
  });
  try { await expect(copyJobStoreForAdmissionOrderMigration(source, candidate)).rejects.toThrow('仍有写入'); }
  finally { loss.mockRestore(); }
  const current = new Database(source, { readonly: true }), stale = new Database(candidate, { readonly: true });
  try {
    expect(current.prepare('SELECT enabled,revision FROM job_triggers').get()).toEqual({ enabled: 0, revision: 2 });
    expect(stale.pragma('user_version', { simple: true })).toBe(4);
    expect(stale.prepare('SELECT enabled,revision FROM job_triggers').get()).toEqual({ enabled: 1, revision: 1 });
  } finally { current.close(); stale.close(); }
  const retry = path.join(directory, 'new-snapshot.sqlite'); await copyJobStoreForAdmissionOrderMigration(source, retry);
  expect(originalRows(retry)).toEqual(originalRows(source));
});

it.each(['version', 'owner', 'missing-window', 'unknown-object', 'extra-column', 'same-path', 'occupied-target'] as const)
('迁移拒绝%s并保留原文件，不把未知owner/窗口或现存目标当空库', async mode => {
  const directory = root(), source = path.join(directory, 'v4.sqlite'), candidate = path.join(directory, 'candidate.sqlite');
  legacy(source);
  const db = new Database(source);
  try {
    if (mode === 'version') db.pragma('user_version=99');
    if (mode === 'owner') db.pragma('application_id=0');
    if (mode === 'missing-window') db.exec('DROP TABLE job_outbox');
    if (mode === 'unknown-object') db.exec('CREATE TABLE unknown_original(value TEXT)');
    if (mode === 'extra-column') db.exec('ALTER TABLE job_source_receipts ADD COLUMN unexpected_private TEXT');
  } finally { db.close(); }
  const hash = createHash('sha256').update(readFileSync(source)).digest('hex');
  if (mode === 'occupied-target') writeFileSync(candidate, 'must-preserve', 'utf8');
  await expect(copyJobStoreForAdmissionOrderMigration(source, mode === 'same-path' ? source : candidate)).rejects.toThrow();
  expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(hash);
  if (mode === 'occupied-target') expect(readFileSync(candidate, 'utf8')).toBe('must-preserve');
});

it.each(['extra-column', 'missing-counter', 'counter-behind', 'zero-sequence', 'fractional-sequence'] as const)
('v5持久窗口%s拒开，保留原Job；未知存储字段不能通过decode进入公开对象', mode => {
  const file = path.join(root(), 'jobs.sqlite'), store = new SqliteJobStore(file);
  store.activateAuthority(1, 1000); store.enqueue(request('original'), 1, 1000); store.close();
  const db = new Database(file);
  try {
    if (mode === 'extra-column') db.exec("ALTER TABLE jobs ADD COLUMN private_text TEXT; UPDATE jobs SET private_text='must-not-expose'");
    if (mode === 'missing-counter') db.exec('DELETE FROM job_enqueue_sequence');
    if (mode === 'counter-behind') db.exec('UPDATE job_enqueue_sequence SET last_sequence=0');
    if (mode === 'zero-sequence') { db.pragma('ignore_check_constraints=ON'); db.exec('UPDATE jobs SET enqueue_sequence=0'); }
    if (mode === 'fractional-sequence') db.exec('UPDATE jobs SET enqueue_sequence=0.5');
  } finally { db.close(); }
  expect(() => new SqliteJobStore(file)).toThrow(/结构无效|持久依据无效/);
  const original = new Database(file, { readonly: true });
  try { expect(original.prepare('SELECT job_id,status,attempt FROM jobs').get()).toEqual({ job_id: 'original', status: 'queued', attempt: 0 }); }
  finally { original.close(); }
});
