import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobAuthorityError, SqliteJobStore, type JobRequest } from '../src/index.js';

it('双连接 claim 互斥，租约截止即失效，重试 token 拒绝旧完成', () => {
  const databasePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-fencing-')), 'jobs.sqlite');
  const first = new SqliteJobStore(databasePath), second = new SqliteJobStore(databasePath);
  const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
  try {
    first.activateAuthority(1, 1000);
    first.enqueue({ ...request, retry_mode: 'idempotent' }, 1, 1000);
    const claim = first.claim(1, 'worker-a', 1000, 100)!;
    expect(second.claim(1, 'worker-b', 1000, 100)).toBeNull();
    expect(second.finish({ ...claim.lease, owner_id: 'worker-b' }, 1001, { status: 'succeeded' })).toBe(false);
    expect(second.renew(claim.lease, 1100, 100)).toBe(false);
    expect(first.finish(claim.lease, 1100, { status: 'succeeded' })).toBe(false);
    expect(second.recoverExpired(1, 1100, { base_delay_ms: 25, max_delay_ms: 100 })).toBe(1);
    expect(first.claim(1, 'worker-b', 1124, 100)).toBeNull();
    const replacement = second.claim(1, 'worker-b', 1125, 100)!;
    expect(replacement.job.attempt).toBe(2);
    expect(replacement.lease.fencing_token).toBeGreaterThan(claim.lease.fencing_token);
    expect(first.finish(claim.lease, 1126, { status: 'succeeded' })).toBe(false);
    expect(second.finish(replacement.lease, 1126, { status: 'succeeded', result: { ok: true } })).toBe(true);
    expect(first.load(request.job_id)?.result).toEqual({ ok: true });
  } finally { first.close(); second.close(); }
});

it('authority epoch 单调，handover 未确认副作用进入 unknown，旧 owner 全面拒写', () => {
  const store = new SqliteJobStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-authority-')), 'jobs.sqlite'));
  const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
  try {
    store.activateAuthority(1, 1000);
    store.enqueue(request, 1, 1000);
    const claim = store.claim(1, 'old-host', 1000, 1000)!;
    store.activateAuthority(2, 1001);
    expect(store.load(request.job_id)?.status).toBe('unknown');
    expect(store.finish(claim.lease, 1002, { status: 'succeeded' })).toBe(false);
    expect(store.renew(claim.lease, 1002, 100)).toBe(false);
    expect(() => store.activateAuthority(1, 1002)).toThrow(JobAuthorityError);
    expect(() => store.enqueue(request, 1, 1002)).toThrow(JobAuthorityError);
    expect(() => store.claim(1, 'old-host', 1002, 100)).toThrow(JobAuthorityError);
    expect(() => store.cancel(request.job_id, 1, 3, 1002)).toThrow(JobAuthorityError);
    expect(store.claim(2, 'new-host', 1002, 100)).toBeNull();
  } finally { store.close(); }
});

it('续期不缩短已有 lease，不改 fencing identity；成功后租约不可复用', () => {
  const store = new SqliteJobStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-renew-')), 'jobs.sqlite'));
  const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
  try {
    store.activateAuthority(1, 1000);
    store.enqueue(request, 1, 1000);
    const claim = store.claim(1, 'worker', 1000, 100)!;
    expect(store.renew(claim.lease, 1050, 200)).toBe(true);
    expect(store.renew(claim.lease, 1060, 10)).toBe(true);
    expect(store.load(request.job_id)?.lease_until).toBe(1250);
    expect(store.load(request.job_id)?.fencing_token).toBe(claim.lease.fencing_token);
    expect(store.finish(claim.lease, 1249, { status: 'succeeded' })).toBe(true);
    expect(store.finish(claim.lease, 1249, { status: 'succeeded' })).toBe(false);
    expect(store.renew(claim.lease, 1249, 100)).toBe(false);
  } finally { store.close(); }
});
