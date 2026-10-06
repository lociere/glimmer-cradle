import { describe, it, expect } from 'vitest';
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
import { CognitionClient, CognitionJobAdapter, HostCognitionError, memoryJobIdentity, memoryJobEvidence } from '../src/index.js';

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
