import { it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { AuthorityConflictError, HandoverController, isAuthorityCurrent, type AuthorityHandover } from '@glimmer-cradle/platform';
import { SqliteJobStore } from '@glimmer-cradle/jobs';
import { CognitionClient, HostJobsOwner, SqliteAuthorityStore } from '../src/index.js';

function databasePath() { return path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-authority-')), 'authority.sqlite'); }
function receipt(handover: AuthorityHandover) {
  return { ...handover.from, transfer_id: handover.transfer_id, drained: true as const };
}
it('Authority 缺失或局部恢复落后 Jobs 时，在获取新租约前失败，不用重复启动追赶旧 epoch', async () => {
  const file = databasePath(), jobs = new SqliteJobStore(`${file}.jobs`), authority = new SqliteAuthorityStore(file);
  try {
    jobs.activateAuthority(10, Date.now());
    for (const round of [0, 1, 2]) {
      if (round === 1) authority.release(authority.acquire('jobs', 'restored-old', Date.now(), 1000), Date.now());
      const client = new CognitionClient('grpc://127.0.0.1:1', `generation-${round}`, 100);
      const owner = new HostJobsOwner({ store: jobs, clock: { now: () => Date.now() }, owner_id: `new-${round}`, cognition: client,
        authority, authority_lease_ms: 1000, renewal_interval_ms: 100, poll_interval_ms: 10, batch_size: 1,
        lease_ms: 1000, retry_policy: { base_delay_ms: 1, max_delay_ms: 10 }, submission_policy: { debounce_ms: 0, max_attempts: 1 } });
      try { await expect(owner.start()).rejects.toThrow('恢复切点不一致'); }
      finally { await owner.stop(); }
      expect(authority.load('jobs')?.epoch ?? null).toBe(round === 0 ? null : 1);
      expect(jobs.loadAuthorityEpoch()).toBe(10);
    }
  } finally { authority.close(); jobs.close(); }
});
it('双连接不重复授予 owner；重开与释放后 epoch/token 单调；失效租约无法续期/撤销新主', () => {
  const file = databasePath();
  let first = new SqliteAuthorityStore(file);
  const other = new SqliteAuthorityStore(file);
  try {
    const old = first.acquire('jobs', 'old', 1000, 100);
    expect(() => other.acquire('jobs', 'old', 1001, 100)).toThrow(AuthorityConflictError);
    expect(() => other.acquire('jobs', 'new', 1099, 100)).toThrow(AuthorityConflictError);
    const renewed = first.renew(old, 1050, 200)!;
    expect(renewed).toMatchObject({ epoch: 1, fencing_token: 1, expires_at: 1250, revision: 2 });
    expect(other.renew(old, 1051, 200)).toBeNull();
    expect(other.renew(renewed, 1250, 200)).toBeNull();
    first.close(); first = new SqliteAuthorityStore(file);
    const next = other.acquire('jobs', 'new', 1250, 100);
    expect(next).toMatchObject({ epoch: 2, fencing_token: 2, revision: 3 });
    expect(first.release(renewed, 1251)).toBe(false);
    expect(isAuthorityCurrent(first.load('jobs'), renewed, 1251)).toBe(false);
    expect(first.release(next, 1251)).toBe(true);
    expect(first.release(next, 1252)).toBe(true);
    expect(first.acquire('jobs', 'third', 1253, 100).epoch).toBe(3);
    expect(first.acquire('memory', 'independent', 1253, 100).epoch).toBe(1);
    expect(() => first.acquire('jobs', 'rollback', 900, 100)).toThrow('UTC 回退');
  } finally { first.close(); other.close(); }
});
it('handover 撤销与确认持久化；拒伪 drain、重复确认保持原 receipt，不刷新新租约', async () => {
  const file = databasePath();
  let store = new SqliteAuthorityStore(file);
  try {
    const old = store.acquire('jobs', 'old', 1000, 1000);
    const handover = store.beginHandover(old, 'new', 'transfer', 1001);
    expect(store.load('jobs')?.status).toBe('revoking');
    expect(store.renew(old, 1002, 1000)).toBeNull();
    expect(() => store.acquire('jobs', 'new', 1002, 1000)).toThrow(AuthorityConflictError);
    expect(store.release(old, 1002)).toBe(false);
    expect(() => store.completeHandover(handover, { ...receipt(handover), epoch: 99 }, 1003, 1000)).toThrow('确认身份');
    store.close(); store = new SqliteAuthorityStore(file);
    expect(store.beginHandover(old, 'new', 'transfer', 1003)).toEqual(handover);
    expect(() => store.beginHandover(old, 'different', 'transfer', 1003)).toThrow('内容冲突');
    const next = store.completeHandover(handover, receipt(handover), 1004, 1000);
    expect(next).toMatchObject({ owner_id: 'new', epoch: 2, fencing_token: 2 });
    const renewed = store.renew(next, 1100, 2000)!;
    expect(store.completeHandover(handover, receipt(handover), 1101, 9000)).toEqual(next);
    expect(store.load('jobs')?.expires_at).toBe(renewed.expires_at);
    const controller = new HandoverController(store, { now: () => 1102 });
    await expect(controller.transfer(renewed, 'third', 'transfer-2', { async revokeAndDrain() { throw new Error('drain failed'); } }, 1000)).rejects.toThrow('drain failed');
    expect(store.load('jobs')?.status).toBe('revoking');
    // 原 owner 崩溃后只能到期 fencing 接管；不能把未确认 drain 解释成业务未发生。
    const third = store.acquire('jobs', 'third', 3100, 1000);
    expect(third.epoch).toBe(3);
    expect(() => store.completeHandover(store.beginHandover(renewed, 'third', 'transfer-2', 3101),
      receipt(store.beginHandover(renewed, 'third', 'transfer-2', 3101)), 3101, 1000)).toThrow('更高 epoch');
  } finally { store.close(); }
});
it('handover 确认与新主原子提交，SQL 故障保留 revoking 和未确认事实', () => {
  const file = databasePath();
  const store = new SqliteAuthorityStore(file), injection = new Database(file);
  try {
    const handover = store.beginHandover(store.acquire('jobs', 'old', 1000, 1000), 'new', 'transfer', 1001);
    injection.exec("CREATE TRIGGER reject_confirmation BEFORE UPDATE ON authority_handovers BEGIN SELECT RAISE(ABORT,'injected'); END");
    expect(() => store.completeHandover(handover, receipt(handover), 1002, 1000)).toThrow('injected');
    expect(store.load('jobs')).toMatchObject({ status: 'revoking', epoch: 1 });
    expect(injection.prepare('SELECT completed_at,receipt_json FROM authority_handovers').get()).toEqual({ completed_at: null, receipt_json: null });
    injection.exec('DROP TRIGGER reject_confirmation');
    expect(store.completeHandover(handover, receipt(handover), 1003, 1000).epoch).toBe(2);
  } finally { injection.close(); store.close(); }
});
it.each(['unknown', 'version', 'owner', 'overflow'] as const)('Authority 拒绝 %s 库/计数，不清理或重建用户状态', mode => {
  const file = databasePath();
  if (mode !== 'unknown') new SqliteAuthorityStore(file).close();
  const db = new Database(file);
  try {
    if (mode === 'unknown') db.exec('CREATE TABLE preserve(value TEXT)');
    if (mode === 'version') db.pragma('user_version=99');
    if (mode === 'owner') db.pragma('application_id=0');
    if (mode === 'overflow') {
      db.prepare("INSERT INTO authority_aggregates VALUES('jobs','old',?,1,1000,1,'released',0)").run(Number.MAX_SAFE_INTEGER);
      const store = new SqliteAuthorityStore(file);
      try { expect(() => store.acquire('jobs', 'new', 1001, 100)).toThrow(AuthorityConflictError); }
      finally { store.close(); }
      expect(db.prepare('SELECT epoch FROM authority_aggregates').get()).toEqual({ epoch: Number.MAX_SAFE_INTEGER });
    } else expect(() => new SqliteAuthorityStore(file)).toThrow(AuthorityConflictError);
    if (mode === 'unknown') expect(db.prepare("SELECT name FROM sqlite_master WHERE name='preserve'").get()).toBeTruthy();
  } finally { db.close(); }
});
it('两个真实进程竞争同一 authority，只有一个获得新租约', async () => {
  const file = databasePath();
  const store = new SqliteAuthorityStore(file);
  const entry = path.resolve(__dirname, '../dist/index.js');
  const script = `const {SqliteAuthorityStore}=require(process.argv[1]); const store=new SqliteAuthorityStore(process.argv[2]);
    process.send({ready:true}); process.stdin.once('data',()=>{let acquired=false;
    try {store.acquire('jobs',process.argv[3],1000,1000); acquired=true;} catch(error) {if(error.constructor.name!=='AuthorityConflictError')throw error;}
    store.close(); process.send({acquired},()=>{process.disconnect();process.stdin.destroy();});});`;
  const contestants = ['a', 'b'].map(owner => {
    const child = spawn(process.execPath, ['-e', script, entry, file, owner], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    let acquired = false, stderr = '';
    child.stderr!.on('data', data => { stderr += String(data); });
    const ready = new Promise<void>((resolve, reject) => {
      child.on('message', message => { if ((message as { ready?: boolean }).ready) resolve(); });
      child.once('error', reject); child.once('exit', code => reject(new Error(`early exit ${code}: ${stderr}`)));
    });
    const done = new Promise<boolean>((resolve, reject) => {
      child.on('message', message => { if ('acquired' in (message as object)) acquired = (message as { acquired: boolean }).acquired; });
      child.once('error', reject); child.once('exit', code => code === 0 ? resolve(acquired) : reject(new Error(stderr)));
    });
    void done.catch(() => undefined);
    return { child, ready, done };
  });
  try {
    await Promise.all(contestants.map(value => value.ready));
    for (const value of contestants) value.child.stdin!.end('go');
    expect((await Promise.all(contestants.map(value => value.done))).filter(Boolean)).toHaveLength(1);
    expect(store.load('jobs')?.epoch).toBe(1);
  } finally { for (const value of contestants) if (value.child.exitCode === null) value.child.kill(); store.close(); }
}, 10_000);
