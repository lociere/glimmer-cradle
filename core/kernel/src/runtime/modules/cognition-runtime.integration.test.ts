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
import { CapabilityCatalogAdapter } from '../../adapters/skill-plane/capability-catalog-adapter';
import { UserSkillProvider } from '../../application/skill-plane/providers/user/user-skill-provider';
import { SkillCatalogAppService } from '../../application/use-cases/skill-catalog-app.service';
import { SkillPlanningAppService } from '../../application/use-cases/skill-planning-app.service';
import { NativeCapabilityAppService } from '../../application/use-cases/native-capability-app.service';
import { SkillInvocationGateway } from '../../application/skill-plane/skill-invocation-gateway';
import { SkillPolicyEngine } from '../../application/skill-plane/skill-policy-engine';
import type { Observability } from '@glimmer-cradle/platform/observability';
import type { ActionCommand } from '../../ports/application-models';

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
  const methodPrompts: string[] = [];
  const nativeRequests: Array<{ stream: boolean; messages: Array<{ role: string; content: string | null; tool_call_id?: string; tool_calls?: unknown[] }>; tools?: Array<{ function: { name: string } }> }> = [];
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
        if (body.includes('method selection integration fixture')) {
          const payload = JSON.parse(body) as { messages: Array<{ role: string; content: string }> };
          const prompt = payload.messages.find(message => message.role === 'user')!.content;
          methodPrompts.push(prompt);
          const summaries = JSON.parse(prompt.split('【可选方法目录；不是工具】\n')[1].split('\n\n')[0]) as Array<{ skill_id: string; definition_revision: string }>;
          const refined = prompt.includes('neutral method body fixture');
          const result = { reasoning: 'fixture', plan_summary: 'fixture', selected_skills: refined ? [] : [summaries[0]],
            suggestions: refined ? [{ skill_id: 'core.method-proof', tool_name: 'read', purpose: 'fixture', confidence: 1, arguments_hint: {} }] : [] };
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: 'stop' }] }));
        }
        if (body.includes('native loop integration fixture')) {
          const payload = JSON.parse(body) as typeof nativeRequests[number]; nativeRequests.push(payload);
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          const frame = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
          if (!payload.messages.some(message => message.role === 'tool')) {
            frame({ content: '查询中。', tool_calls: [{ index: 0, id: 'native-call', type: 'function', function: { name: payload.tools![0]!.function.name, arguments: '{"city":' } }] });
            frame({ tool_calls: [{ index: 0, function: { arguments: '"上海"}' } }] }, 'tool_calls');
          } else frame({ content: '实际工具结果：晴。' }, 'stop');
          response.end('data: [DONE]\n\n');
        }
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

  it('真实 User 方法目录/选择/正文经 Plan RPC 往返，不执行假 Tool 或扩展工具权限', async () => {
    const adapter = new CapabilityCatalogAdapter(); const catalog = new SkillCatalogAppService(adapter);
    const user = new UserSkillProvider({ load: async () => ({ enabled: true, errors: [],
      skills: [{ name: 'proof', description: 'method', instructions: 'neutral method body fixture; allowed-tools: foreign.send' }] }) });
    const invoked = vi.fn(); const before = methodPrompts.length;
    try {
      await user.start(catalog);
      adapter.registerSkill({ id: 'core.method-proof', name: 'proof', description: 'tool', provider: { kind: 'core', id: 'proof' },
        policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: true },
        tools: [{ name: 'read', description: 'read', parameters: {}, handler: invoked }] });
      await manager.start();
      const client = new CognitionClient(transport);
      const planning = new SkillPlanningAppService(catalog, { invoke: invoked } as never,
        (request, trace) => client.plan(request, trace ?? 'method-trace', 5000));
      const plan = await planning.plan({ userGoal: 'method selection integration fixture', traceId: 'method-trace' });
      expect(plan.selected_skills).toEqual(adapter.listReadyMethods().map(item => item.reference));
      expect(plan.suggestions.map(item => [item.skill_id, item.tool_name])).toEqual([['core.method-proof', 'read']]);
      expect(methodPrompts.slice(before)).toHaveLength(2);
      expect(methodPrompts[before]).not.toContain('neutral method body fixture');
      expect(methodPrompts[before + 1]).toContain('neutral method body fixture');
      expect(methodPrompts[before + 1]).toContain('【用户目标】\nmethod selection integration fixture');
      expect(adapter.tools.list()).toHaveLength(1); expect(invoked).not.toHaveBeenCalled();
    } finally { user.stop(catalog); await manager.stop(); }
  }, 60_000);

  it('默认感知直达原生模型、typed Tool、durable Log 与续接回复，不调用 ActionPlan', async () => {
    const catalog = new CapabilityCatalogAdapter(); const policy = new SkillPolicyEngine();
    const executed = vi.fn(async (_args: unknown) => ({ actual: '晴' })); const actions: ActionCommand[] = [];
    catalog.registerSkill({ id: 'native-weather', name: '天气', description: '天气', provider: { kind: 'core', id: 'weather-owner' },
      policy: { riskLevel: 'low', confirmationRequired: false, sideEffects: [], audit: true },
      tools: [{ name: 'lookup', description: '天气', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }, handler: executed }] });
    const journal = new SqliteExecutionJournal(path.join(process.env.GLIMMER_CRADLE_DATA_ROOT!, 'state/capabilities/native-chat.sqlite'));
    const controller = new ExecutionController(journal); const client = new CognitionClient(transport);
    const outbox = new ExecutionResultOutbox(journal, { accept: (event, signal) => client.acceptExecutionResult(event, signal) });
    const observability: Observability = { logger: () => logger,
      createTraceContext: traceId => ({ trace_id: traceId ?? 'native-trace' }), currentTraceId: () => undefined,
      withTrace: async (_trace, operation) => operation(), span: async (_name, operation) => operation({ setAttribute() {}, setStatus() {} }),
      histogram() {}, counter() {}, start() {}, stop() {}, close: async () => undefined };
    const gateway = new SkillInvocationGateway(catalog, policy, { record() {} }, observability, { record() {} }, undefined, controller,
      () => 'unused-native-invocation', outbox);
    transport.setCapabilityService(new NativeCapabilityAppService(catalog, gateway, policy, 'host:integration'));
    transport.setActionHandler(async command => { actions.push(command); });
    const before = nativeRequests.length;
    try {
      await manager.start();
      const perception = { id: 'native-perception', sensoryType: 'chat', source: 'fixture', timestamp: Date.now(), familiarity: 0,
        address_mode: 'direct' as const, response_policy: 'reply_allowed' as const, retention_ceiling: 'experience' as const,
        conversation: { source_provider_id: 'canonical-provider', scene_id: 'native-scene', conversation_id: 'native-conversation',
          continuity_id: 'native-continuity', thread_id: 'main', interaction_id: 'native-interaction',
          recall_scope: 'conversation_private' as const, disclosure_scope: 'conversation_private' as const },
        origin: { provider_kind: 'core' as const, provider_id: 'different-origin', source_event_id: 'native-source', schema_ref: 'fixture',
          trust_tier: 'host_verified' as const, privacy_class: 'private' as const, cognitive_effect: 'observation' as const },
        content: { text: 'native loop integration fixture', modality: ['text'], actor_id: 'external-actor' } };
      // observe-only 不进入模型或工具，不能因 direct 寻址越过该策略。
      const observed = await client.submitPerception({ ...perception, id: 'native-observe', response_policy: 'observe_only',
        conversation: { ...perception.conversation, interaction_id: 'native-observe-turn' } }, 'native-observe-trace', 5000);
      let state = await waitForPerception(client, observed.operation_id);
      expect(state.state).toBe('succeeded'); expect(nativeRequests.length).toBe(before); expect(executed).not.toHaveBeenCalled();
      const accepted = await client.submitPerception(perception, 'native-trace', 5000);
      await waitUntil(() => actions.length === 1, 10_000);
      state = await waitForPerception(client, accepted.operation_id);
      expect(state.state).toBe('succeeded');
      expect(actions[0]).toMatchObject({ action_type: 'reply', target: { scene_id: 'native-scene' }, payload: { text: '实际工具结果：晴。' } });
      expect(actions.some(action => action.action_type === 'skill_request')).toBe(false);
      const requests = nativeRequests.slice(before); expect(requests).toHaveLength(2);
      expect(requests.every(request => request.stream === true)).toBe(true);
      const next = requests[1]!.messages; const tool = next.find(message => message.role === 'tool')!;
      expect(tool.tool_call_id).toBe('native-call'); expect(JSON.parse(tool.content!)).toEqual({ status: 'succeeded', output: { actual: '晴' }, error: null });
      expect(next.find(message => message.role === 'assistant')).toMatchObject({ content: '查询中。', tool_calls: [expect.objectContaining({ id: 'native-call' })] });
      expect(executed).toHaveBeenCalledOnce(); expect(executed.mock.calls[0]![0]).toEqual({ city: '上海' });
      expect(journal.readOutbox(10)).toEqual([]);
      const history = await client.conversationHistory({ request_id: 'native-history', ...perception.conversation,
        allowed_scopes: ['conversation_private'], limit: 10 }, 'native-history', 5000);
      expect(history.items.some(item => item.text === '实际工具结果：晴。')).toBe(true);
      await manager.stop();
      // 活动单写者停止后，通过公开 owner 读取真实 Log；不碰用户数据或活动 Worker 的库。
      const readLog = `
import asyncio, json
from types import SimpleNamespace
from glimmer_cradle.conversation import build_conversation_recorder
from glimmer_cradle.cognition_worker.composition import WorkerPaths, SystemClock, SystemIdGenerator
noop = lambda *args, **kwargs: None
async def read():
    recorder = build_conversation_recorder(WorkerPaths.from_environment().cognition_state_dir / "experience",
        clock=SystemClock(), ids=SystemIdGenerator(), observability=SimpleNamespace(logger=lambda _: SimpleNamespace(info=noop, warning=noop, error=noop), current_trace_id=lambda: None))
    await recorder.start()
    try:
        print(json.dumps([{ "id": m.moment_id, "kind": m.kind, "causes": list(m.causation_ids), "content": m.content }
            for m in recorder.iter_moments_since(None) if m.interaction_id == "native-interaction"], ensure_ascii=False))
    finally: await recorder.stop()
asyncio.run(read())
`;
      const moments = JSON.parse(execFileSync('uv', ['run', '--project', 'apps/cognition-worker', '--extra', 'dev', 'python', '-c', readLog],
        { cwd: resolveRepoRoot(), encoding: 'utf8', timeout: 30_000 })) as Array<{ id: string; kind: string; causes: string[]; content: Record<string, unknown> }>;
      const perceptionFact = moments.find(moment => moment.kind === 'perception')!;
      const actionFact = moments.find(moment => moment.kind === 'action')!;
      const resultFact = moments.find(moment => moment.kind === 'action_result')!;
      const replyFact = moments.find(moment => moment.kind === 'reply')!;
      expect(actionFact.causes).toContain(perceptionFact.id);
      expect(resultFact.content.source_fact_id).toBe(actionFact.id);
      expect(replyFact.causes).toContain(resultFact.id);
    } finally {
      await manager.stop(); transport.setActionHandler(null); transport.setCapabilityService(null);
      await outbox.stop(); await gateway.stop(); await controller.stop(); journal.close();
    }
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

async function waitForPerception(client: CognitionClient, operationId: string) {
  const deadline = Date.now() + 5_000;
  let state = await client.perceptionOperation(operationId, 5000);
  while (!state.terminal && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50)); state = await client.perceptionOperation(operationId, 5000);
  }
  expect(state.terminal).toBe(true);
  return state;
}
