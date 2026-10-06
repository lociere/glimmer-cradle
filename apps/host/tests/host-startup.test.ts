import { describe, it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { create } from '@bufbuild/protobuf';
import { ReadMemoryJobRequestsRequestSchema, ExecuteMemoryJobRequestSchema,
  MemoryJobResultSchema, MemoryJobResolution } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { JobController, JobRecoveryController, SqliteJobStore, type Job } from '@glimmer-cradle/jobs';
import { ServiceErrorCode } from '@glimmer-cradle/contracts/glimmer/common/v1/service_contract_pb';
import { CognitionClient, CognitionJobAdapter, HostCognitionError, HostJobsController,
  memoryJobIdentity, memoryJobEvidence, memoryJobRequest } from '../src/index.js';

const repository = path.resolve(__dirname, '../../..');
const policy = { base_delay_ms: 1, max_delay_ms: 10 };
const submissionPolicy = { debounce_ms: 0, max_attempts: 3 };
const clock = { now: () => Date.now() };
async function worker(root: string, generation: string) {
  const child = spawn('uv', ['run', '--project', 'apps/cognition-worker', '--extra', 'dev', 'python',
    'apps/cognition-worker/tests/test_rpc_roundtrip.py', '--host-job-fixture', root, generation],
  { cwd: repository, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr!.on('data', data => { stderr = (stderr + String(data)).slice(-4096); });
  const stopped = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Worker fixture exit ${code}: ${stderr}`)));
  });
  void stopped.catch(() => undefined);
  let client: CognitionClient | undefined;
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker fixture readiness timeout')), 15_000);
      const lines = createInterface({ input: child.stdout! });
      child.once('error', reject);
      void stopped.then(() => reject(new Error('Worker fixture exited before ready')), reject);
      lines.on('line', line => {
        if (!line.startsWith('{"endpoint":')) return;
        const ready = JSON.parse(line);
        clearTimeout(timer); lines.close(); resolve(ready.endpoint);
      });
    });
    client = new CognitionClient(endpoint, generation, 5_000);
    return { client, endpoint, child, async stop() { client!.close(); child.stdin!.end('stop\n'); await stopped; } };
  } catch (error) { client?.close(); if (child.exitCode === null) child.kill(); await stopped.catch(() => undefined); throw error; }
}
function memoryCounts(root: string) {
  const db = new Database(path.join(root, 'memory.sqlite'), { readonly: true });
  try { return ['memory_items', 'memory_revisions', 'memory_consolidation_receipts'].map(table =>
    (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count); }
  finally { db.close(); }
}

function hostJobs(store: SqliteJobStore, client: CognitionClient, epoch = 1, batch = 8) {
  return new HostJobsController({ store, clock, epoch, owner_id: `host-${epoch}`, cognition: client,
    poll_interval_ms: 10, batch_size: batch, lease_ms: 60_000,
    submission_policy: submissionPolicy, retry_policy: policy });
}
async function eventually(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  expect(predicate()).toBe(true);
}

describe('Host Memory Jobs 持续驱动与资源归属', () => {
  it('真实 Worker 自动投递、执行一次；重复 start 共用循环，停机关闭 client 而不关闭注入 Store', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-loop-'));
    const service = await worker(root, 'one');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const host = hostJobs(store, service.client);
    let activeReads = 0, maxActiveReads = 0;
    const actualRead = service.client.readRequests.bind(service.client);
    const reads = vi.spyOn(service.client, 'readRequests').mockImplementation(async (...args: Parameters<CognitionClient['readRequests']>) => {
      activeReads += 1; maxActiveReads = Math.max(maxActiveReads, activeReads);
      try { await new Promise(resolve => setTimeout(resolve, 25)); return await actualRead(...args); }
      finally { activeReads -= 1; }
    });
    try {
      store.activateAuthority(1, clock.now());
      store.enqueue({ job_id: 'other', scope_id: 'scope', goal_id: 'goal', kind: 'other.owner',
        idempotency_key: 'other', payload: {}, due_at: 0, retry_mode: 'idempotent', max_attempts: 1 }, 1, clock.now());
      const first = host.start();
      expect(host.start()).toBe(first);
      expect(await first).toMatchObject({ status: 'ready', completed_cycles: 1, error_code: null });
      await eventually(() => host.snapshot.completed_cycles >= 3);
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
      expect(store.load('other')).toMatchObject({ status: 'queued', attempt: 0 });
      expect(host.stop()).toBe(host.stop());
      await host.stop();
      expect(host.snapshot.status).toBe('stopped');
      const completedReads = reads.mock.calls.length;
      await new Promise(resolve => setTimeout(resolve, 40));
      expect(reads.mock.calls.length).toBe(completedReads);
      expect(maxActiveReads).toBe(1);
      expect(activeReads).toBe(0);
      expect(store.readOutbox(1, 100).length).toBeGreaterThan(0); // 无持久 receiver 不伪造 ACK。
      await expect(service.client.readRequests(create(ReadMemoryJobRequestsRequestSchema, { limit: 1 }))).rejects.toBeInstanceOf(HostCognitionError);
      await expect(host.start()).rejects.toThrow('撤销');
    } finally { await host.stop(); reads.mockRestore(); store.close(); await service.stop(); }
  }, 30_000);

  it('真实 Memory 已提交但响应丢失，后续循环从持久 unknown 自动对账，不重复执行', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-loop-recovery-'));
    const service = await worker(root, 'one');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const host = hostJobs(store, service.client);
    const execute = service.client.execute.bind(service.client);
    const calls = vi.spyOn(service.client, 'execute').mockImplementationOnce(async (...args: Parameters<CognitionClient['execute']>) => {
      await execute(...args); throw new HostCognitionError(ServiceErrorCode.UNAVAILABLE);
    });
    try {
      expect(await host.start()).toMatchObject({ status: 'degraded', error_code: 'jobs_recovery_pending' });
      const original = store.listUnknown(1, 'memory.consolidate', 8)[0];
      expect(original).toBeTruthy();
      await eventually(() => store.load(original.job_id)?.status === 'succeeded');
      expect(calls).toHaveBeenCalledTimes(1);
      expect(store.load(original.job_id)?.attempt).toBe(1);
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
      expect(host.snapshot.status).toBe('ready');
    } finally { await host.stop(); calls.mockRestore(); store.close(); await service.stop(); }
  }, 30_000);

  it('真实模型执行中 stop：先取消并封口，再撤销 client，回收完毕才允许关闭 Store', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-loop-stop-'));
    const service = await worker(root, 'waiting-model');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const host = hostJobs(store, service.client);
    const memory = new Database(path.join(root, 'memory.sqlite'), { readonly: true });
    try {
      const starting = host.start();
      const observed = starting.catch(error => error);
      await eventually(() => !!memory.prepare("SELECT job_id FROM memory_job_attempts WHERE state='active'").get());
      await host.stop();
      expect(await observed).toBeInstanceOf(Error);
      expect(memory.prepare('SELECT state FROM memory_job_attempts').get()).toEqual({ state: 'sealed' });
      expect(memoryCounts(root)).toEqual([0, 0, 0]);
      expect(store.listUnknown(1, 'memory.consolidate', 8)).toHaveLength(1);
      expect(host.snapshot.status).toBe('stopped');
    } finally { await host.stop(); memory.close(); store.close(); await service.stop(); }
  }, 30_000);

  it('源 RPC 等待期间 stop 取消当前 signal，停机后没有 enqueue 或延迟回调', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-loop-read-stop-'));
    const service = await worker(root, 'one');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const host = hostJobs(store, service.client);
    let entered = false, aborted = false;
    const read = vi.spyOn(service.client, 'readRequests').mockImplementation((_request, signal) => new Promise((_resolve, reject) => {
      entered = true;
      signal!.addEventListener('abort', () => { aborted = true; reject(signal!.reason); }, { once: true });
    }));
    try {
      const observed = host.start().catch(error => error);
      await eventually(() => entered);
      await host.stop();
      expect(await observed).toBeInstanceOf(Error);
      expect(aborted).toBe(true);
      expect(store.claim(1, 'check', clock.now(), 100)).toBeNull();
      expect(host.snapshot.completed_cycles).toBe(0);
    } finally { await host.stop(); read.mockRestore(); store.close(); await service.stop(); }
  }, 30_000);

  it('暂未 ready 不冒充 ready；随后恢复，而持久分页不被首个 unavailable unknown 阻塞', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-loop-pagination-'));
    const service = await worker(root, 'one');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const host = hostJobs(store, service.client, 2, 1);
    const read = vi.spyOn(service.client, 'readRequests').mockRejectedValueOnce(new HostCognitionError(ServiceErrorCode.NOT_READY));
    const query = service.client.reconcile.bind(service.client);
    const queries = vi.spyOn(service.client, 'reconcile').mockImplementation((request, signal) => {
      if (request.identity?.jobId === 'a') return Promise.reject(new HostCognitionError(ServiceErrorCode.UNAVAILABLE));
      return query(request, signal);
    });
    try {
      // 用真正源输入创建两个在途原身份，转移后分别成为未知；所有查询仍走真实接收 owner。
      const actualRead = CognitionClient.prototype.readRequests.bind(service.client);
      const request = memoryJobRequest((await actualRead(create(ReadMemoryJobRequestsRequestSchema, { limit: 1 }))).requests[0], submissionPolicy);
      store.activateAuthority(1, clock.now());
      for (const id of ['a', 'b']) {
        store.enqueue({ ...request, job_id: id, idempotency_key: id, max_attempts: 1 }, 1, clock.now());
        expect(store.claim(1, 'old', clock.now(), 60_000, 'memory.consolidate')?.job.job_id).toBe(id);
      }
      expect(await host.start()).toMatchObject({ status: 'degraded', error_code: 'cognition_unavailable' });
      await eventually(() => store.load('b')?.status === 'dead_letter');
      expect(store.load('a')?.status).toBe('unknown');
      expect(queries.mock.calls.map(([request]) => request.identity?.jobId)).toContain('b');
      expect(host.snapshot.status).toBe('degraded');
    } finally { await host.stop(); read.mockRestore(); queries.mockRestore(); store.close(); await service.stop(); }
  }, 30_000);

  it('authority 切换后旧循环失败关闭，不重新激活旧主或继续投递', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-loop-fenced-'));
    const service = await worker(root, 'one');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const other = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const host = hostJobs(store, service.client);
    try {
      await host.start();
      other.activateAuthority(2, clock.now());
      await eventually(() => host.snapshot.status === 'failed');
      expect(host.snapshot.error_code).toBe('jobs_cycle_failed');
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
      await expect(service.client.readRequests(create(ReadMemoryJobRequestsRequestSchema, { limit: 1 }))).rejects.toBeInstanceOf(HostCognitionError);
      expect(other.claim(2, 'new', clock.now(), 100)).toBeNull();
      await expect(host.start()).rejects.toThrow('撤销');
    } finally { await host.stop(); other.close(); store.close(); await service.stop(); }
  }, 30_000);

  it('非法源摘要导致失败关闭，而不是后台重复吞错或将源 ACK', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-loop-bad-source-'));
    const service = await worker(root, 'one');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const host = hostJobs(store, service.client);
    const actualRead = service.client.readRequests.bind(service.client);
    const reads = vi.spyOn(service.client, 'readRequests').mockImplementation(async (...args: Parameters<CognitionClient['readRequests']>) => {
      const response = await actualRead(...args); response.requests[0].inputDigest = 'invalid'; return response;
    });
    const acks = vi.spyOn(service.client, 'acknowledge');
    try {
      await expect(host.start()).rejects.toThrow('摘要');
      expect(host.snapshot).toMatchObject({ status: 'failed', error_code: 'jobs_cycle_failed', completed_cycles: 0 });
      expect(acks).not.toHaveBeenCalled();
      expect(store.claim(1, 'check', clock.now(), 100)).toBeNull();
      expect(memoryCounts(root)).toEqual([0, 0, 0]);
      await new Promise(resolve => setTimeout(resolve, 40));
      expect(reads).toHaveBeenCalledTimes(1);
    } finally { await host.stop(); reads.mockRestore(); acks.mockRestore(); store.close(); await service.stop(); }
  }, 30_000);
});

describe('Host Jobs 消费真实 Worker Memory owner', () => {
  it('源 enqueue 已提交而 ACK 丢失：重开 Jobs 原请求重放并完成一次 Memory', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-source-'));
    const service = await worker(root, 'one');
    let store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    let first = true;
    const port = { execute: service.client.execute.bind(service.client), reconcile: service.client.reconcile.bind(service.client),
      readRequests: service.client.readRequests.bind(service.client), acknowledge: async (...args: Parameters<CognitionClient['acknowledge']>) => {
        if (first) { first = false; throw new Error('injected ACK loss'); }
        return service.client.acknowledge(...args);
      } };
    const adapter = new CognitionJobAdapter(port);
    const controller = new JobController(store, clock, policy);
    try {
      store.activateAuthority(1, clock.now());
      await expect(adapter.deliverRequests(store, clock, 1, submissionPolicy, 8)).rejects.toThrow('ACK loss');
      const sources = (await service.client.readRequests(create(ReadMemoryJobRequestsRequestSchema, { limit: 8 }))).requests;
      expect(sources).toHaveLength(1);
      const jobId = `memory:${sources[0].requestId}`;
      expect(store.load(jobId)?.status).toBe('queued');
      store.close(); store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
      store.activateAuthority(2, clock.now());
      expect(await adapter.deliverRequests(store, clock, 2, submissionPolicy, 8)).toBe(1);
      expect(await adapter.deliverRequests(store, clock, 2, submissionPolicy, 8)).toBe(0);
      const actual = new JobController(store, clock, policy);
      actual.register(adapter);
      const result = await actual.execute(store.claim(2, 'host-two', clock.now(), 60_000)!);
      expect(result).toMatchObject({ job_id: jobId, status: 'succeeded', attempt: 1 });
      expect(result?.result?.memory_ids).toHaveLength(1);
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
      await actual.stop();
    } finally { await controller.stop(); store.close(); await service.stop(); }
  }, 30_000);

  it('Memory 已提交而完成响应丢失：跨 Worker/Jobs 重启对账原 attempt，不再执行', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-reconcile-'));
    let service = await worker(root, 'one');
    let store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    let controller = new JobController(store, clock, policy);
    try {
      store.activateAuthority(1, clock.now());
      const adapter = new CognitionJobAdapter({ execute: async (...args) => {
        await service.client.execute(...args); throw new Error('injected completion response loss');
      }, reconcile: service.client.reconcile.bind(service.client), readRequests: service.client.readRequests.bind(service.client),
      acknowledge: service.client.acknowledge.bind(service.client) });
      await adapter.deliverRequests(store, clock, 1, submissionPolicy, 8);
      controller.register(adapter);
      const claim = store.claim(1, 'original-host', clock.now(), 60_000)!;
      expect((await controller.execute(claim))?.status).toBe('unknown');
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
      await controller.stop(); store.close(); await service.stop();
      service = await worker(root, 'two');
      store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
      store.activateAuthority(2, clock.now());
      controller = new JobController(store, clock, policy);
      const recovery = new JobRecoveryController(store, clock, 2, policy);
      const query = new CognitionJobAdapter(service.client);
      const result = await recovery.reconcile(claim.job.job_id, query);
      expect(result).toMatchObject({ status: 'accepted', job: { status: 'succeeded', attempt: 1 } });
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
      expect(store.claim(2, 'new-host', clock.now(), 60_000)).toBeNull();
      const attempt = store.listAttempts(claim.job.job_id)[0];
      expect(attempt).toMatchObject({ authority_epoch: 1, owner_id: 'original-host', fencing_token: claim.lease.fencing_token });
    } finally { await controller.stop(); store.close(); await service.stop(); }
  }, 30_000);

  it('原执行未到达：对账持久封口后允许新 attempt，旧 epoch 不替代原证据', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-not-applied-'));
    const service = await worker(root, 'one');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const controller = new JobController(store, clock, policy);
    try {
      store.activateAuthority(1, clock.now());
      const adapter = new CognitionJobAdapter(service.client);
      await adapter.deliverRequests(store, clock, 1, submissionPolicy, 8);
      const claim = store.claim(1, 'old-host', clock.now(), 60_000)!;
      store.activateAuthority(2, clock.now());
      const recovery = new JobRecoveryController(store, clock, 2, policy);
      expect(await recovery.reconcile(claim.job.job_id, adapter)).toMatchObject({ status: 'accepted', job: { status: 'retry_wait' } });
      expect(memoryCounts(root)).toEqual([0, 0, 0]);
      await new Promise(resolve => setTimeout(resolve, 5));
      controller.register(adapter);
      const next = store.claim(2, 'new-host', clock.now(), 60_000)!;
      expect(next.job.attempt).toBe(2);
      expect((await controller.execute(next))?.status).toBe('succeeded');
      expect(memoryCounts(root)).toEqual([1, 1, 1]);
    } finally { await controller.stop(); store.close(); await service.stop(); }
  }, 30_000);

  it('非法 generation 不提交 Jobs；client 关闭拒绝后续请求', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-generation-'));
    const service = await worker(root, 'one');
    const wrong = new CognitionClient(service.endpoint, 'old', 2000);
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    try {
      store.activateAuthority(1, clock.now());
      await expect(new CognitionJobAdapter(wrong).deliverRequests(store, clock, 1, submissionPolicy, 8)).rejects.toBeInstanceOf(HostCognitionError);
      expect(store.claim(1, 'host', clock.now(), 60_000)).toBeNull();
      wrong.close();
      await expect(wrong.readRequests(create(ReadMemoryJobRequestsRequestSchema, { limit: 8 }))).rejects.toBeInstanceOf(HostCognitionError);
    } finally { wrong.close(); store.close(); await service.stop(); }
  }, 30_000);

  it('取消真实在途模型并封口原 attempt，晚到重放不能提交 Memory', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-cancel-'));
    const service = await worker(root, 'waiting-model');
    const store = new SqliteJobStore(path.join(root, 'jobs.sqlite'));
    const controller = new JobController(store, clock, policy);
    try {
      store.activateAuthority(1, clock.now());
      const adapter = new CognitionJobAdapter(service.client);
      await adapter.deliverRequests(store, clock, 1, submissionPolicy, 8);
      controller.register(adapter);
      const claim = store.claim(1, 'host', clock.now(), 60_000)!;
      const pending = controller.execute(claim);
      const memory = new Database(path.join(root, 'memory.sqlite'), { readonly: true });
      try {
        const deadline = Date.now() + 2000;
        while (!memory.prepare("SELECT job_id FROM memory_job_attempts WHERE state='active'").get() && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(memory.prepare("SELECT job_id FROM memory_job_attempts WHERE state='active'").get()).toBeTruthy();
        expect(controller.cancel(claim.job.job_id, 1, store.load(claim.job.job_id)!.revision)?.status).toBe('cancelled');
        expect((await pending)?.status).toBe('cancelled');
        expect(memory.prepare('SELECT state FROM memory_job_attempts').get()).toEqual({ state: 'sealed' });
        expect(memoryCounts(root)).toEqual([0, 0, 0]);
        await expect(service.client.execute(create(ExecuteMemoryJobRequestSchema, {
          identity: memoryJobIdentity(claim.job), episodeId: String(claim.job.payload.episode_id),
          episodeVersion: BigInt(Number(claim.job.payload.episode_version)), inputDigest: String(claim.job.payload.input_digest),
        }))).rejects.toBeInstanceOf(HostCognitionError);
        expect(memoryCounts(root)).toEqual([0, 0, 0]);
      } finally { memory.close(); }
    } finally { await controller.stop(); store.close(); await service.stop(); }
  }, 30_000);
});

it.each(['scope', 'epoch', 'token', 'owner', 'seal', 'source', 'resolution', 'evidence'] as const)('Host 拒绝 %s 漂移证据', mode => {
  const job = { job_id: 'job', scope_id: 'scope', attempt: 1, authority_epoch: 1, fencing_token: 1,
    lease_owner: 'owner', lease_until: 60_000 } as Job;
  const identity = memoryJobIdentity(job);
  const result = create(MemoryJobResultSchema, { identity, sourceId: 'cognition.memory', receiverFenced: true,
    resolution: MemoryJobResolution.NOT_APPLIED, observedAtMs: 1000n });
  if (mode === 'scope') result.identity!.scopeId = 'wrong';
  if (mode === 'epoch') result.identity!.authorityEpoch = 2n;
  if (mode === 'token') result.identity!.fencingToken = 2n;
  if (mode === 'owner') result.identity!.ownerId = 'wrong';
  if (mode === 'seal') result.receiverFenced = false;
  if (mode === 'source') result.sourceId = 'untrusted';
  if (mode === 'resolution') result.resolution = MemoryJobResolution.UNSPECIFIED;
  const actual = result.identity!;
  result.evidenceId = createHash('sha256').update(JSON.stringify([actual.jobId, actual.scopeId, Number(actual.attempt),
    Number(actual.authorityEpoch), Number(actual.fencingToken), actual.ownerId, 'not_applied', 'sealed'])).digest('hex');
  if (mode === 'evidence') result.evidenceId = 'invalid';
  expect(() => memoryJobEvidence(result, memoryJobIdentity(job))).toThrow();
});
