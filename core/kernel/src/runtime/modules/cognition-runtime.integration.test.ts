import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { create } from '@bufbuild/protobuf';
import { JobExecutionIdentitySchema } from '@glimmer-cradle/contracts/glimmer/jobs/v1/jobs_pb';
import { ReconcileMemoryJobRequestSchema, MemoryJobResolution } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { KernelCognitionTransport } from '../../adapters/cognition/kernel-cognition-transport';
import { CognitionClient } from '../../adapters/cognition/cognition-client';
import { ConfigManager } from '../../adapters/config/config-manager';
import { EndpointRegistry } from '../../adapters/endpoints/endpoint-registry';
import { CognitionManager } from '../../adapters/cognition/cognition-process-adapter';
import { ManageCognitionLifecycle } from '../../application/use-cases/manage-cognition-lifecycle';
import { IngressGateManager } from '../../application/ingress/ingress-gate-manager';
import { CognitionRuntime } from './cognition-runtime';
import { KernelTransportRuntime } from './kernel-transport-runtime';
import { createTraceContext } from '../../adapters/observability/trace-context';
import { RuntimeReadinessProjectionMapper } from '../../application/projection/runtime-readiness-projection';
import type { KernelConfiguration } from '../../ports/configuration.port';
import { SystemClockAdapter } from '../../adapters/time/system-clock-adapter';
import { resolveRepoRoot } from '../../adapters/filesystem/path-utils';
import { ExecutionController, ExecutionResultOutbox, SqliteExecutionJournal } from '@glimmer-cradle/capabilities';

const runIntegration = process.env.GLIMMER_CRADLE_RUN_COGNITION_INTEGRATION === '1';

it('Cognition 启动关闭入口但保持 starting；真正失败才发布 failed', () => {
  const projection = new RuntimeReadinessProjectionMapper();
  const logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined, critical: () => undefined };
  const transport = new KernelTransportRuntime({} as KernelConfiguration, new KernelCognitionTransport(), new IngressGateManager(logger, new SystemClockAdapter()), projection);
  const runtime = new CognitionRuntime(transport, { isReady: false, start: async () => {}, stop: async () => {} }, projection);
  runtime.acceptLifecycleFact('starting', '等待注册');
  expect(projection.getCatalog().runtimes.find(item => item.runtime_id === 'kernel.ingress')?.state).toBe('starting');
  runtime.acceptLifecycleFact('failed', '注册失败');
  expect(projection.getCatalog().runtimes.find(item => item.runtime_id === 'kernel.ingress')?.state).toBe('failed');
});

describe.skipIf(!runIntegration)('CognitionManager real process integration', () => {
  let transportRuntime: KernelTransportRuntime;
  const transport = new KernelCognitionTransport();
  const projection = new RuntimeReadinessProjectionMapper();
  const logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined, critical: () => undefined };
  let manager: CognitionManager;
  let provider: Server;
  const previousDataRoot = process.env.GLIMMER_CRADLE_DATA_ROOT;
  let providerRequests = 0;
  let providerDisconnects = 0;
  beforeAll(async () => {
    process.env.GLIMMER_CRADLE_DATA_ROOT = await mkdtemp(path.join(os.tmpdir(), 'glimmer-worker-lifecycle-'));
    provider = createServer((request, response) => {
      // 故意不返回响应，验证 Shutdown 取消真实网络请求而非只取消等待者。
      let body = '';
      let isCancellationFixture = false;
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { body += chunk; });
      request.on('end', () => {
        isCancellationFixture = body.includes('shutdown cancellation fixture');
        if (isCancellationFixture) providerRequests += 1;
      });
      response.on('close', () => { if (isCancellationFixture) providerDisconnects += 1; });
    });
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    await ConfigManager.instance.init();
    const config = structuredClone(ConfigManager.instance.getConfig());
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('本地 provider fixture 未绑定');
    config.character.llm = {
      api_type: 'openai', api_key: 'test-only-key',
      base_url: `http://127.0.0.1:${address.port}`, models: { chat: 'test-model' },
    };
    vi.spyOn(ConfigManager.instance, 'getConfig').mockReturnValue(config);
    vi.spyOn(ConfigManager.instance, 'loadDashScopeSecretEnvironment').mockResolvedValue({});
    transportRuntime = new KernelTransportRuntime(
      ConfigManager.instance.getConfig() as unknown as KernelConfiguration,
      transport,
      new IngressGateManager(logger, new SystemClockAdapter()),
      projection,
    );
    let cognitionRuntime!: CognitionRuntime;
    manager = new CognitionManager(
      transport,
      new CognitionClient(transport),
      (state, summary) => cognitionRuntime.acceptLifecycleFact(state, summary),
      'external',
    );
    cognitionRuntime = new CognitionRuntime(
      transportRuntime,
      new ManageCognitionLifecycle(manager),
      projection,
    );
    await transportRuntime.start(createTraceContext());
  });

  afterAll(async () => {
    await manager.stop();
    await transportRuntime.stop(createTraceContext());
    await EndpointRegistry.instance.close();
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    vi.restoreAllMocks();
    if (previousDataRoot === undefined) delete process.env.GLIMMER_CRADLE_DATA_ROOT;
    else process.env.GLIMMER_CRADLE_DATA_ROOT = previousDataRoot;
  });

  it('starts, reaches readiness, stops and recovers with a fresh supervised generation', async () => {
    await manager.start();
    expect(manager.isReady).toBe(true);
    expect(await manager.sendLifeHeartbeat({})).toEqual({ status: 'alive' });
    const firstGeneration = transport.generation;
    const firstChild = (manager as unknown as { child: ChildProcess }).child;

    await manager.stop();
    expect(firstChild.exitCode).toBe(0);
    expect(firstChild.signalCode).toBeNull();
    expect(manager.isReady).toBe(false);
    expect(EndpointRegistry.instance.get('cognition-rpc')).toBeUndefined();

    await manager.start();
    expect(manager.isReady).toBe(true);
    expect(transport.generation).not.toBe(firstGeneration);
    const secondChild = (manager as unknown as { child: ChildProcess }).child;
    await manager.stop();
    expect(secondChild.exitCode).toBe(0);
    expect(secondChild.signalCode).toBeNull();
  }, 60_000);

  it('persists original Memory Job sealed evidence across a real Worker restart', async () => {
    await manager.start();
    const identity = create(JobExecutionIdentitySchema, { jobId: 'integration:memory-job', scopeId: 'scope:integration',
      attempt: 1n, authorityEpoch: 10n, fencingToken: 20n, ownerId: 'host:integration', leaseUntilMs: BigInt(Date.now() + 60_000) });
    const reconcile = () => transport.call(transport.methods.ReconcileMemoryJob,
      create(ReconcileMemoryJobRequestSchema, { call: transport.makeCallMetadata({ traceId: 'memory-job-reconcile' }), identity }),
      { timeoutMs: 5000, traceId: 'memory-job-reconcile' });
    const first = (await reconcile()).result!;
    expect(first.identity).toEqual(identity);
    expect(first.resolution).toBe(MemoryJobResolution.NOT_APPLIED);
    expect(first.receiverFenced).toBe(true);
    expect(first.sourceId).toBe('cognition.memory');
    expect(first.evidenceId).not.toBe('');
    expect(first.receiptId).toBe('');
    await manager.stop();
    await manager.start();
    const recovered = (await reconcile()).result!;
    expect(recovered.identity).toEqual(identity);
    expect(recovered.evidenceId).toBe(first.evidenceId);
    expect(recovered.observedAtMs).toBe(first.observedAtMs);
    expect(recovered.receiverFenced).toBe(true);
    expect(recovered.resolution).toBe(MemoryJobResolution.NOT_APPLIED);
    await manager.stop();
  }, 60_000);

  it('真实 Execution outbox 经 Conversation Service 接纳，ACK 丢失与 Worker 重启不重新执行', async () => {
    // Worker 停止时由公开 Conversation owner 写 synthetic 原事实；不绕过活动单写者。
    const seed = `
import asyncio, json
from types import SimpleNamespace
from glimmer_cradle.conversation import build_conversation_recorder, MomentKind
from glimmer_cradle.cognition_worker.composition import WorkerPaths, SystemClock, SystemIdGenerator
noop = lambda *args, **kwargs: None
logger = SimpleNamespace(info=noop, warning=noop, error=noop)
async def seed():
    recorder = build_conversation_recorder(WorkerPaths.from_environment().cognition_state_dir / "experience",
        clock=SystemClock(), ids=SystemIdGenerator(), observability=SimpleNamespace(logger=lambda _: logger, current_trace_id=lambda: None))
    await recorder.start()
    try:
        fact = recorder.record(MomentKind.ACTION, {"action_type": "skill_request"},
            conversation_id="integration:conversation", scene_id="integration:scene", interaction_id="integration:turn",
            trace_id="integration:turn", idempotency_key="integration:execution-source")
        await recorder.flush()
        print(json.dumps({"source_fact_id": fact.moment_id}))
    finally:
        await recorder.stop()
asyncio.run(seed())
`;
    const source = JSON.parse(execFileSync('uv', ['run', '--project', 'apps/cognition-worker', '--extra', 'dev', 'python', '-c', seed],
      { cwd: resolveRepoRoot(), encoding: 'utf8', timeout: 30_000 }));
    const file = path.join(process.env.GLIMMER_CRADLE_DATA_ROOT!, 'state/capabilities/execution-proof.sqlite');
    let journal = new SqliteExecutionJournal(file);
    const executed = vi.fn(async () => ({ state: 'succeeded' as const, side_effects: 'confirmed' as const, result: { text: '真实结果' } }));
    const request = { invocation_id: 'integration:invocation', idempotency_key: 'integration:invocation', scope_id: 'integration:conversation',
      target: { executor_id: 'integration:executor', capability_id: 'integration:tool', definition_revision: 'actual' }, input: null,
      interaction: { conversation_id: 'integration:conversation', source_fact_id: source.source_fact_id } };
    const executor = { authorize: async () => ({ allowed: true, decision: {} }), validateBeforeDispatch: () => true, execute: executed };
    try {
      await manager.start();
      const client = new CognitionClient(transport);
      const controller = new ExecutionController(journal);
      await controller.execute(request, executor);
      const event = journal.readOutbox(1)[0];
      const abort = new AbortController();
      const lost = new ExecutionResultOutbox(journal, { accept: async actual => {
        const receipt = await client.acceptExecutionResult(actual); abort.abort(); return receipt;
      } });
      await expect(lost.publish(event, abort.signal)).rejects.toThrow();
      expect(journal.readOutbox(1)).toHaveLength(1);
      const first = await client.acceptExecutionResult(event);
      const generation = transport.generation;
      await manager.stop(); journal.close(); journal = new SqliteExecutionJournal(file);
      await manager.start(); expect(transport.generation).not.toBe(generation);
      const replay = new ExecutionController(journal);
      expect((await replay.execute(request, executor)).state).toBe('succeeded');
      expect(await client.acceptExecutionResult(event)).toEqual(first);
      const publisher = new ExecutionResultOutbox(journal, { accept: (actual, signal) => client.acceptExecutionResult(actual, signal) });
      expect(await publisher.deliverPending(10)).toEqual({ delivered: 1, failed: 0 });
      expect(journal.readOutbox(1)).toEqual([]); expect(executed).toHaveBeenCalledOnce();
      await publisher.stop(); await replay.stop(); await controller.stop();
    } finally { await manager.stop(); journal.close(); }
  }, 60_000);

  it('cancels an in-flight provider request and exits gracefully on shutdown', async () => {
    await manager.start();
    const child = (manager as unknown as { child: ChildProcess }).child;
    const requestsBefore = providerRequests;
    const disconnectsBefore = providerDisconnects;
    const pending = manager.sendAgentPlan({ user_goal: 'shutdown cancellation fixture', available_tools: [] })
      .then(() => 'completed', () => 'cancelled');
    await waitUntil(() => providerRequests > requestsBefore);
    await manager.stop();
    expect(await pending).toBe('cancelled');
    await waitUntil(() => providerDisconnects > disconnectsBefore);
    expect(child.exitCode).toBe(0);
    expect(child.signalCode).toBeNull();
  }, 60_000);

  it('revokes required ingress on crash and restores it only after a fresh generation is ready', async () => {
    await manager.start();
    transportRuntime.openIngress();
    const firstGeneration = transport.generation;
    const child = (manager as unknown as { child: { kill(): boolean } | null }).child;
    expect(child).not.toBeNull();
    child!.kill();

    await waitUntil(() => !manager.isReady);
    const failedIngress = projection.getCatalog().runtimes
      .find((runtime) => runtime.runtime_id === 'kernel.ingress');
    expect(failedIngress?.state).toBe('failed');

    await waitUntil(() => manager.isReady, 30_000);
    expect(transport.generation).not.toBe(firstGeneration);
    const recoveredIngress = projection.getCatalog().runtimes
      .find((runtime) => runtime.runtime_id === 'kernel.ingress');
    expect(recoveredIngress?.state).toBe('ready');
    await manager.stop();
  }, 60_000);

  it('keeps ingress closed after restart failure and reopens only after explicit recovery', async () => {
    const previousRuntime = process.env.GLIMMER_CRADLE_PYTHON_RUNTIME;
    await manager.start();
    transportRuntime.openIngress();
    const attemptsBeforeCrash = (manager as unknown as { recoveryAttempts: number })
      .recoveryAttempts;
    process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = 'Z:\\missing\\glimmer-cognition-python.exe';
    const child = (manager as unknown as { child: { kill(): boolean } | null }).child;
    child!.kill();
    try {
      await waitUntil(() => !manager.isReady);
      await waitUntil(() => {
        const state = manager as unknown as {
          child: unknown;
          starting: boolean;
          recoveryAttempts: number;
        };
        return state.recoveryAttempts > attemptsBeforeCrash
          && state.child === null
          && state.starting === false;
      }, 10_000);
      const failed = projection.getCatalog().runtimes;
      expect(failed.find((runtime) => runtime.runtime_id === 'kernel.ingress')?.state).toBe('failed');
      expect(failed.find((runtime) => runtime.runtime_id === 'cognition')?.state).toBe('failed');
    } finally {
      if (previousRuntime === undefined) delete process.env.GLIMMER_CRADLE_PYTHON_RUNTIME;
      else process.env.GLIMMER_CRADLE_PYTHON_RUNTIME = previousRuntime;
    }
    await manager.start();
    expect(manager.isReady).toBe(true);
    expect(projection.getCatalog().runtimes
      .find((runtime) => runtime.runtime_id === 'kernel.ingress')?.state).toBe('ready');
    await manager.stop();
  }, 60_000);
});

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  expect(predicate()).toBe(true);
}
