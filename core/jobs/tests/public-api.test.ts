import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as jobs from '../src/index.js';
import type { JobRequest } from '../src/index.js';

describe('Jobs public API', () => {
  it('接纳分页前进/回绕，首批等待不饿死后续 due Job，不消耗 attempt/预算或创建 outbox', async () => {
    const store = new jobs.SqliteJobStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-admission-pages-')), 'jobs.sqlite'));
    const clock = { now: () => 1000 }, controller = new jobs.JobController(store, clock, { base_delay_ms: 1, max_delay_ms: 10 });
    const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
    const checked: string[] = [], executed: string[] = [];
    let allow = false;
    try {
      store.activateAuthority(1, 1000);
      for (const id of ['a', 'b', 'c', 'd', 'foreign']) store.enqueue({ ...request, job_id: id, idempotency_key: id,
        kind: id === 'foreign' ? 'foreign.kind' : request.kind }, 1, 1000);
      controller.register({ kind: request.kind, retry_mode: request.retry_mode, async execute(context) {
        executed.push(context.job.job_id); return { status: 'succeeded', result: {} };
      } });
      const scheduler = new jobs.JobScheduler(store, controller, clock, 1, 'host', 100, request.kind,
        { kind: request.kind, async isEligible(job) { checked.push(job.job_id); return allow || job.job_id >= 'c'; } });
      expect(await scheduler.runDue(2)).toBe(0); expect(scheduler.waitingCount).toBe(2);
      expect(store.readOutbox(1, 100)).toHaveLength(5);
      expect(await scheduler.runDue(2)).toBe(2); expect(executed).toEqual(['c', 'd']);
      expect(await scheduler.runDue(2)).toBe(0); // 最后一页为空后回绕。
      allow = true;
      expect(await scheduler.runDue(2)).toBe(2); expect(checked).toEqual(['a', 'b', 'c', 'd', 'a', 'b']);
      expect(store.load('a')).toMatchObject({ attempt: 1, max_attempts: 3, due_at: 1000 });
      expect(store.load('foreign')).toMatchObject({ status: 'queued', attempt: 0 });
    } finally { await controller.stop(); store.close(); }
  });

  it.each(['cancel', 'competing-claim', 'epoch', 'stop', 'abort', 'clock'] as const)
  ('接纳 await 期间 %s 后只 CAS 原候选，不执行失效判断或另一未接纳 Job', async fault => {
    const databasePath = path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-admission-race-')), 'jobs.sqlite');
    const store = new jobs.SqliteJobStore(databasePath), other = new jobs.SqliteJobStore(databasePath);
    let now = 1000;
    const clock = { now: () => now }, controller = new jobs.JobController(store, clock, { base_delay_ms: 1, max_delay_ms: 10 });
    const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
    const signal = new AbortController();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const executed: string[] = [];
    try {
      store.activateAuthority(1, now);
      for (const id of ['a', 'b']) store.enqueue({ ...request, job_id: id, idempotency_key: id }, 1, now);
      controller.register({ kind: request.kind, retry_mode: request.retry_mode, async execute(context) {
        executed.push(context.job.job_id); return { status: 'succeeded', result: {} };
      } });
      const scheduler = new jobs.JobScheduler(store, controller, clock, 1, 'host', 100, request.kind,
        { kind: request.kind, async isEligible() { entered(); await gate; return true; } });
      const pending = scheduler.runDue(1, signal.signal); void pending.catch(() => undefined);
      await started;
      if (fault === 'cancel') other.cancel('a', 1, 1, now);
      if (fault === 'competing-claim') other.claim(1, 'other', now, 100, request.kind);
      if (fault === 'epoch') other.activateAuthority(2, now);
      if (fault === 'stop') await controller.stop();
      if (fault === 'abort') signal.abort();
      if (fault === 'clock') now = 999;
      release();
      if (fault === 'epoch' || fault === 'abort') await expect(pending).rejects.toThrow();
      else expect(await pending).toBe(0);
      expect(executed).toEqual([]);
      expect(store.load('b')).toMatchObject({ status: 'queued', attempt: 0 });
      expect(store.load('a')?.attempt).toBe(fault === 'competing-claim' ? 1 : 0);
    } finally { release(); await controller.stop(); other.close(); store.close(); }
  });

  it('接纳范围/kind/CAS 输入失败关闭，非布尔 true 不能触发 claim', async () => {
    const store = new jobs.SqliteJobStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-admission-invalid-')), 'jobs.sqlite'));
    const clock = { now: () => 1000 }, controller = new jobs.JobController(store, clock, { base_delay_ms: 1, max_delay_ms: 10 });
    const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
    try {
      store.activateAuthority(1, 1000); store.enqueue(request, 1, 1000);
      const admission = { kind: request.kind, async isEligible() { return 'true' as unknown as boolean; } };
      expect(() => new jobs.JobScheduler(store, controller, clock, 1, 'host', 100, 'wrong', admission)).toThrow();
      const scheduler = new jobs.JobScheduler(store, controller, clock, 1, 'host', 100, request.kind, admission);
      for (const limit of [0, 1001, NaN]) {
        await expect(scheduler.runDue(limit)).rejects.toThrow();
        expect(() => store.listDue(1, request.kind, 1000, limit)).toThrow();
      }
      expect(() => store.listDue(0, request.kind, 1000, 1)).toThrow();
      expect(() => store.claim(1, 'host', 1000, 100, request.kind, { job_id: request.job_id, revision: 0 })).toThrow();
      expect(await scheduler.runDue(1)).toBe(0);
      expect(store.load(request.job_id)).toMatchObject({ status: 'queued', attempt: 0 });
    } finally { await controller.stop(); store.close(); }
  });

  it('App 取消调度 signal 后不再 claim；kind 过滤不提前判死其他 owner 的工作', async () => {
    const store = new jobs.SqliteJobStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-jobs-scheduler-stop-')), 'jobs.sqlite'));
    const controller = new jobs.JobController(store, { now: () => 1000 }, { base_delay_ms: 1, max_delay_ms: 10 });
    const request = JSON.parse(readFileSync(path.resolve(__dirname, 'fixtures/job.json'), 'utf8')) as JobRequest;
    const stop = new AbortController();
    try {
      store.activateAuthority(1, 1000);
      for (const id of ['a', 'b', 'foreign']) store.enqueue({ ...request, job_id: id, idempotency_key: id,
        kind: id === 'foreign' ? 'other.owner' : request.kind }, 1, 1000);
      controller.register({ kind: request.kind, retry_mode: request.retry_mode, async execute() {
        stop.abort(); return { status: 'succeeded', result: {} };
      } });
      const scheduler = new jobs.JobScheduler(store, controller, { now: () => 1000 }, 1, 'host', 100, request.kind);
      await expect(scheduler.runDue(10, stop.signal)).rejects.toMatchObject({ name: 'AbortError' });
      expect(store.load('a')?.status).toBe('succeeded');
      expect(store.load('b')).toMatchObject({ status: 'queued', attempt: 0 });
      expect(store.load('foreign')).toMatchObject({ status: 'queued', attempt: 0 });
      await expect(scheduler.runDue(10, stop.signal)).rejects.toMatchObject({ name: 'AbortError' });
    } finally { await controller.stop(); store.close(); }
  });

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

  it('真实 Scheduler 把一次性 trigger 持久入队并交给受控 handler，仅执行一次', async () => {
    const store = new jobs.SqliteJobStore(path.join(mkdtempSync(path.join(os.tmpdir(), 'glimmer-jobs-trigger-chain-')), 'jobs.sqlite'));
    let now = 999;
    const clock = { now: () => now };
    const controller = new jobs.JobController(store, clock, { base_delay_ms: 25, max_delay_ms: 100 });
    const received: unknown[] = [];
    try {
      store.activateAuthority(1, now);
      const trigger = new jobs.JobTriggerController(store, clock, 1);
      trigger.register({ trigger_id: 'once', scope_id: 'scope', goal_id: 'goal', kind: 'test.once',
        payload: { evidence_id: 'fact' }, retry_mode: 'reconcile', max_attempts: 1, schedule: { kind: 'once', due_at: 1000 } });
      controller.register({ kind: 'test.once', retry_mode: 'reconcile', async execute(context, payload) {
        context.assertLease();
        received.push(payload);
        return { status: 'succeeded', result: { done: true } };
      } });
      const scheduler = new jobs.JobScheduler(store, controller, clock, 1, 'worker', 100);
      expect(await scheduler.runDue(10)).toBe(0);
      now = 1000;
      expect(await scheduler.runDue(10)).toBe(1);
      expect(received).toEqual([{ input: { evidence_id: 'fact' }, occurrence: {
        occurrence_id: 'schedule:1000', occurred_at: 1000, payload: {},
      } }]);
      expect(store.loadTrigger('once')).toMatchObject({ next_due_at: null, last_due_at: 1000 });
      expect(await scheduler.runDue(10)).toBe(0);
    } finally { await controller.stop(); store.close(); }
  });
});
