import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { JobRecoveryController, SqliteJobStore, type JobRequest } from '../src/index.js';

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

it('拒绝未知 schema 或其他 owner 的旧库，保留原表', () => {
  const databasePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-job-schema-')), 'jobs.sqlite');
  const foreign = new Database(databasePath);
  foreign.exec('CREATE TABLE original(value TEXT); INSERT INTO original VALUES(\'preserved\')');
  foreign.close();
  expect(() => new SqliteJobStore(databasePath)).toThrow('未知 Jobs 数据库');
  const unchanged = new Database(databasePath);
  try {
    expect(unchanged.prepare('SELECT value FROM original').get()).toEqual({ value: 'preserved' });
    unchanged.pragma('user_version=2');
  } finally { unchanged.close(); }
  expect(() => new SqliteJobStore(databasePath)).toThrow('schema version');
});
