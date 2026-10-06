import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as jobs from '../src/index.js';
import type { JobRequest } from '../src/index.js';

describe('Jobs public API', () => {
  it('从公开入口接通 trigger → SQLite → due scheduler → handler → durable result', async () => {
    const store = new jobs.SqliteJobStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-jobs-')), 'jobs.sqlite'));
    let now = 999;
    const clock = { now: () => now };
    const controller = new jobs.JobController(store, clock, { base_delay_ms: 25, max_delay_ms: 100 });
    const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
    const calls: number[] = [];
    try {
      store.activateAuthority(1, now);
      controller.register({ kind: request.kind, retry_mode: 'reconcile', async execute(context, payload) {
        context.assertLease();
        context.renew(100);
        calls.push(context.lease.fencing_token);
        return { status: 'succeeded', result: { evidence_id: payload.evidence_id } };
      } });
      const trigger = new jobs.JobTriggerController(store, clock, 1);
      expect(trigger.submit(request).duplicate).toBe(false);
      const scheduler = new jobs.JobScheduler(store, controller, clock, 1, 'worker-1', 100);
      expect(await scheduler.runDue(10)).toBe(0);
      now = 1000;
      expect(await scheduler.runDue(10)).toBe(1);
      expect(store.load(request.job_id)).toMatchObject({ status: 'succeeded', attempt: 1, result: request.payload });
      expect(calls).toEqual([1]);
      expect(await scheduler.runDue(10)).toBe(0);
      expect(trigger.submit(request).duplicate).toBe(true);
      await controller.stop();
      trigger.submit({ ...request, job_id: 'after-stop', idempotency_key: 'after-stop' });
      expect(await scheduler.runDue(10)).toBe(0);
      expect(store.load('after-stop')?.status).toBe('queued');
    } finally { await controller.stop(); store.close(); }
  });

  it('拒绝非法时间与不可序列化的 payload，而不是静默改变请求身份', () => {
    const store = new jobs.SqliteJobStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-jobs-json-')), 'jobs.sqlite'));
    const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
    try {
      store.activateAuthority(1, 0);
      expect(() => store.enqueue({ ...request, due_at: NaN }, 1, 0)).toThrow();
      expect(() => store.enqueue({ ...request, payload: { invalid: undefined } }, 1, 0)).toThrow();
      expect(() => store.enqueue({ ...request, payload: { invalid: Infinity } }, 1, 0)).toThrow();
      expect(store.load(request.job_id)).toBeNull();
    } finally { store.close(); }
  });

  it('执行不信调用方 claim snapshot，拒绝替换 kind/payload；同 attempt 仅执行一次', async () => {
    const store = new jobs.SqliteJobStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-jobs-snapshot-')), 'jobs.sqlite'));
    const controller = new jobs.JobController(store, { now: () => 1000 }, { base_delay_ms: 25, max_delay_ms: 100 });
    const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
    const received: unknown[] = [];
    try {
      store.activateAuthority(1, 1000);
      store.enqueue(request, 1, 1000);
      controller.register({ kind: request.kind, retry_mode: 'reconcile', async execute(context, payload) {
        received.push(payload);
        context.assertLease();
        return { status: 'succeeded', result: {} };
      } });
      const claim = store.claim(1, 'worker', 1000, 100)!;
      const fabricated = { ...claim, job: { ...claim.job, kind: 'forged', payload: { forged: true } } };
      const pending = controller.execute(fabricated);
      expect(controller.execute(claim)).toBe(pending);
      await pending;
      expect(received).toEqual([request.payload]);
    } finally { await controller.stop(); store.close(); }
  });

  it.each([
    { retry_mode: 'idempotent', max_attempts: 3, handler_mode: 'idempotent', expected: 'retry_wait' },
    { retry_mode: 'reconcile', max_attempts: 3, handler_mode: 'reconcile', expected: 'unknown' },
    { retry_mode: 'idempotent', max_attempts: 1, handler_mode: 'idempotent', expected: 'dead_letter' },
    { retry_mode: 'idempotent', max_attempts: 3, handler_mode: 'reconcile', expected: 'dead_letter' },
  ] as const)('handler 故障/策略不匹配按明确政策恢复: $expected/$retry_mode/$max_attempts', async (scenario) => {
    const store = new jobs.SqliteJobStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-jobs-handler-')), 'jobs.sqlite'));
    const controller = new jobs.JobController(store, { now: () => 1000 }, { base_delay_ms: 25, max_delay_ms: 100 });
    const base = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
    let calls = 0;
    try {
      store.activateAuthority(1, 1000);
      store.enqueue({ ...base, retry_mode: scenario.retry_mode, max_attempts: scenario.max_attempts }, 1, 1000);
      controller.register({ kind: base.kind, retry_mode: scenario.handler_mode, async execute() {
        calls += 1;
        throw new Error('private provider body must not become error_code');
      } });
      await controller.execute(store.claim(1, 'worker', 1000, 100)!);
      expect(store.load(base.job_id)?.status).toBe(scenario.expected);
      expect(calls).toBe(scenario.retry_mode === scenario.handler_mode ? 1 : 0);
      expect(store.load(base.job_id)?.error_code).not.toContain('private');
      if (scenario.expected === 'retry_wait') expect(store.load(base.job_id)?.due_at).toBe(1025);
    } finally { await controller.stop(); store.close(); }
  });
});
