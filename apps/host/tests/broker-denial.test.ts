import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { create } from '@bufbuild/protobuf';
import { ExposeStepRequestSchema, ReadResourceRequestSchema, CollectKnowledgeResourceRequestSchema, ValidateKnowledgeResourceRequestSchema,
  type CollectKnowledgeResourceResponse } from '@glimmer-cradle/contracts/glimmer/capabilities/v1/capabilities_pb';
import { ExecutionController, ExecutionResultOutbox, SqliteExecutionJournal, ResourceRegistry, ExecutionRecoveryRequiredError } from '@glimmer-cradle/capabilities';
import type { Resource, ExecutionResultReceiverPort } from '@glimmer-cradle/capabilities';
import { PermissionBroker, HostResourceContributions } from '../src/index.js';
import { WorkerSupervisor } from '../src/index.js';
import { PublishStateResponseSchema, PublishActionResponseSchema } from '@glimmer-cradle/contracts/glimmer/kernel/v1/kernel_control_service_pb';
import { SubmitPerceptionRequestSchema, GetPerceptionOperationRequestSchema, AddressMode, ResponsePolicy, RetentionCeiling,
  PerceptionOperationState } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import type { PermissionRequest } from '@glimmer-cradle/platform';

const principal = { principal_id: 'worker', host_id: 'host', generation: 'generation', kind: 'service' as const };
const request: PermissionRequest = { ...principal, permission: 'resource.read', resource_id: 'document', resource_revision: 'definition:1', target_location: 'host:local' };
const resource: Resource = { id: 'document', owner_id: 'reader-owner', reader_id: 'reader', revision: 'definition:1',
  name: '资料', description: '仅摘要', audience: 'character', readiness: 'ready', scopes: [{ kind: 'conversation', ids: ['conversation'] }],
  input_schema: { type: 'object', additionalProperties: false } };

function harness(receiver?: ExecutionResultReceiverPort) {
  let now = 100;
  const audit = vi.fn(); const broker = new PermissionBroker(() => now, audit);
  const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-resource-broker-'));
  const journal = new SqliteExecutionJournal(path.join(root, 'execution.sqlite'));
  const controller = new ExecutionController(journal);
  const outbox = new ExecutionResultOutbox(journal, receiver ?? { accept: async event => ({ event_id: event.event_id,
    invocation_id: event.invocation.invocation_id, revision: event.invocation.revision, accepted: true }) });
  const service = new HostResourceContributions({ host_id: 'host', target_location: 'host:local', permissions: broker,
    resources: new ResourceRegistry(), execution: controller, outbox, now: () => now });
  service.activatePrincipal('worker', 'generation');
  const reader = vi.fn(async () => '实际资料'); service.registerResource(resource, reader);
  const expose = (drift = {}) => service.exposeStep(create(ExposeStepRequestSchema, { call: { generation: 'generation', traceId: 'trace' },
    runId: 'run', step: 1, scope: { sourceProviderId: 'provider', sceneId: 'scene', conversationId: 'conversation' },
    protocolFeatures: ['capability-read.v1'], maxDefinitions: 10, maxDefinitionBytes: 65536, remainingToolCalls: 2, ...drift }), 'worker', new AbortController().signal);
  const read = (drift = {}, signal = new AbortController().signal) => service.readResource(create(ReadResourceRequestSchema, { request: {
    call: { generation: 'generation', traceId: 'trace', idempotencyKey: 'run:call' }, runId: 'run', step: 1, callId: 'call', name: 'glimmer_read_resource',
    reference: { id: 'document', revision: 'definition:1' }, sourceFactId: 'source-fact',
    scope: { sourceProviderId: 'provider', sceneId: 'scene', conversationId: 'conversation' }, arguments: {}, ...drift,
  } }), 'worker', signal);
  return { service, broker, reader, journal, expose, read, audit, time: (value: number) => { now = value; },
    close: async () => { await service.stop(); journal.close(); } };
}

const knowledgePolicy = { source_id: 'source:document', reference: { id: 'document', revision: 'definition:1' },
  scope: { source_provider_id: 'provider', scene_id: 'scene', conversation_id: 'conversation' }, arguments: {}, max_age_ms: 50 };
function collectKnowledge(h: ReturnType<typeof harness>, drift = {}) {
  return h.service.collectKnowledgeResource(create(CollectKnowledgeResourceRequestSchema, {
    call: { generation: 'generation', traceId: 'knowledge-trace' }, sourceId: knowledgePolicy.source_id,
    reference: knowledgePolicy.reference, scope: { sourceProviderId: 'provider', sceneId: 'scene', conversationId: 'conversation' }, ...drift,
  }), 'worker', new AbortController().signal);
}
function validateKnowledge(h: ReturnType<typeof harness>, proof: CollectKnowledgeResourceResponse, drift = {}) {
  return h.service.validateKnowledgeResource(create(ValidateKnowledgeResourceRequestSchema, {
    call: { generation: 'generation', traceId: 'knowledge-trace' }, access: proof.access,
    reference: proof.content!.reference, contentRevision: proof.content!.contentRevision, mediaType: proof.content!.mediaType,
    scope: { sourceProviderId: 'provider', sceneId: 'scene', conversationId: 'conversation' }, ...drift,
  }), 'worker', new AbortController().signal);
}

describe('显式 Knowledge IO 接纳与可撤销采集证明', () => {
  it('global 来源无需伪造 Conversation/Step；不能丢弃 private scope 获取相同权限', async () => {
    const h = harness();
    try {
      expect(() => h.service.registerKnowledgeAccess('worker', { ...knowledgePolicy, scope: undefined })).toThrow('不可见');
      h.service.registerKnowledgeAccess('worker', knowledgePolicy);
      h.broker.grant(request, 300); h.broker.grant({ ...request, permission: 'knowledge.ingest' }, 300);
      await expect(collectKnowledge(h, { scope: undefined })).rejects.toThrow('scope');
      const privateProof = await collectKnowledge(h);
      expect((await validateKnowledge(h, privateProof, { scope: undefined })).current).toBe(false);
      h.service.revokeKnowledgeAccess('worker', knowledgePolicy.source_id);
      h.service.registerResource({ ...resource, revision: 'definition:2', scopes: [{ kind: 'global' }] }, h.reader);
      h.broker.grant({ ...request, resource_revision: 'definition:2' }, 300);
      h.broker.grant({ ...request, resource_revision: 'definition:2', permission: 'knowledge.ingest' }, 300);
      h.service.registerKnowledgeAccess('worker', { ...knowledgePolicy, reference: { id: 'document', revision: 'definition:2' }, scope: undefined });
      const proof = await collectKnowledge(h, { reference: { id: 'document', revision: 'definition:2' }, scope: undefined });
      expect((await validateKnowledge(h, proof, { scope: undefined })).current).toBe(true);
      expect((await validateKnowledge(h, proof)).current).toBe(false);
    } finally { await h.close(); }
  });
  it('声明不是授权；读取与采集双 grant 缺一不可，模型加载没有采集证明', async () => {
    const h = harness();
    try {
      await expect(collectKnowledge(h)).rejects.toThrow('接纳');
      h.service.registerKnowledgeAccess('worker', knowledgePolicy);
      await expect(collectKnowledge(h)).rejects.toThrow('授权');
      h.broker.grant(request, 300); await expect(collectKnowledge(h)).rejects.toThrow('授权');
      h.broker.grant({ ...request, permission: 'knowledge.ingest' }, 300);
      const proof = await collectKnowledge(h);
      expect(proof.content!.contentUtf8).toBe('实际资料'); expect(proof.access!.sourceId).toBe(knowledgePolicy.source_id);
      expect((await validateKnowledge(h, proof)).current).toBe(true);
      expect(h.journal.readOutbox(10)).toEqual([]);
      expect(h.reader).toHaveBeenCalledOnce();
      await expect(collectKnowledge(h, { sourceId: 'model-invented' })).rejects.toThrow('接纳');
      expect(h.reader).toHaveBeenCalledOnce();
    } finally { await h.close(); }
  });
  it('采集证明绑定实际主体/来源/定义/内容/权限修订/时刻/scope；过期回拨不复活', async () => {
    const h = harness();
    try {
      h.service.registerKnowledgeAccess('worker', knowledgePolicy);
      h.broker.grant(request, 300); h.broker.grant({ ...request, permission: 'knowledge.ingest' }, 300);
      const proof = await collectKnowledge(h);
      for (const drift of [{ sourceId: 'other' }, { principalId: 'other' }, { permissionRevision: 'forged' },
        { accessId: 'forged' }, { collectedAtMs: 0n }, { expiresAtMs: 300n }]) {
        expect((await validateKnowledge(h, proof, { access: { ...proof.access, ...drift } })).current).toBe(false);
      }
      for (const drift of [{ reference: { id: 'other', revision: 'definition:1' } }, { contentRevision: 'forged' }, { mediaType: 'application/json' },
        { scope: { sourceProviderId: 'provider', sceneId: 'scene', conversationId: 'other' } }]) {
        expect((await validateKnowledge(h, proof, drift)).current).toBe(false);
      }
      h.time(151); expect((await validateKnowledge(h, proof)).current).toBe(false);
      h.time(101); expect((await validateKnowledge(h, proof)).current).toBe(false);
    } finally { await h.close(); }
  });
  it.each(['read', 'ingest', 'definition', 'source', 'content'] as const)('%s 撤销使原采集证明即时失效', async change => {
    const h = harness();
    try {
      h.service.registerKnowledgeAccess('worker', knowledgePolicy);
      const read = h.broker.grant(request, 300), ingest = h.broker.grant({ ...request, permission: 'knowledge.ingest' }, 300);
      const proof = await collectKnowledge(h);
      if (change === 'read') h.broker.revokeGrant(read.grant_id);
      else if (change === 'ingest') h.broker.revokeGrant(ingest.grant_id);
      else if (change === 'source') h.service.revokeKnowledgeAccess('worker', knowledgePolicy.source_id);
      else if (change === 'content') {
        expect(() => h.service.invalidateResourceContent('document', 'foreign')).toThrow('owner');
        expect((await validateKnowledge(h, proof)).current).toBe(true);
        h.service.invalidateResourceContent('document', 'reader-owner');
        const refreshed = await collectKnowledge(h);
        expect((await validateKnowledge(h, refreshed)).current).toBe(true);
        expect(refreshed.content!.reference).toEqual(proof.content!.reference);
      }
      else h.service.registerResource({ ...resource, revision: 'definition:2' }, async () => '新资料');
      expect((await validateKnowledge(h, proof)).current).toBe(false);
    } finally { await h.close(); }
  });
  it('较早采集迟到不能覆盖更新的采集证明', async () => {
    const h = harness(); let release!: () => void, enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
    h.service.revokeResource('document', 'reader-owner');
    h.service.registerResource(resource, async () => { if (++calls === 1) { enter(); await gate; return '旧资料'; } return '新资料'; });
    h.service.registerKnowledgeAccess('worker', knowledgePolicy);
    h.broker.grant(request, 300); const ingest = h.broker.grant({ ...request, permission: 'knowledge.ingest' }, 300);
    try {
      const first = collectKnowledge(h), rejected = expect(first).rejects.toThrow('失效'); await entered;
      const current = await collectKnowledge(h); release(); await rejected;
      expect(current.content!.contentUtf8).toBe('新资料'); expect((await validateKnowledge(h, current)).current).toBe(true);
      h.broker.revokeGrant(ingest.grant_id); expect((await validateKnowledge(h, current)).current).toBe(false);
    } finally { release(); await h.close(); }
  });
  it('单来源最多两次在途采集；超限不替换已接纳 attempt 或额外读取', async () => {
    const h = harness(); let release!: () => void, enter!: () => void; let calls = 0;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    h.service.revokeResource('document', 'reader-owner');
    h.service.registerResource(resource, async () => { if (++calls === 2) enter(); await gate; return '资料'; });
    h.service.registerKnowledgeAccess('worker', knowledgePolicy);
    h.broker.grant(request, 300); h.broker.grant({ ...request, permission: 'knowledge.ingest' }, 300);
    const first = collectKnowledge(h), rejected = expect(first).rejects.toThrow('失效');
    const second = collectKnowledge(h);
    try {
      await entered; await expect(collectKnowledge(h)).rejects.toThrow('预算'); expect(calls).toBe(2);
      release(); await rejected; expect((await validateKnowledge(h, await second)).current).toBe(true);
    } finally { release(); await h.close(); }
  });
  it.each(['read', 'ingest', 'content', 'source'] as const)('%s 失效取消在途采集；reader 忽略取消的迟到正文不返回', async change => {
    const h = harness(); let release!: () => void, enter!: () => void; let signal!: AbortSignal;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    h.service.revokeResource('document', 'reader-owner');
    h.service.registerResource(resource, async (_arguments, actualSignal) => { signal = actualSignal; enter(); await gate; return '迟到资料'; });
    h.service.registerKnowledgeAccess('worker', knowledgePolicy);
    const read = h.broker.grant(request, 300), ingest = h.broker.grant({ ...request, permission: 'knowledge.ingest' }, 300);
    const collecting = collectKnowledge(h), rejected = expect(collecting).rejects.toThrow();
    try {
      await entered;
      if (change === 'content') h.service.invalidateResourceContent('document', 'reader-owner');
      else if (change === 'source') h.service.revokeKnowledgeAccess('worker', knowledgePolicy.source_id);
      else h.broker.revokeGrant(change === 'read' ? read.grant_id : ingest.grant_id);
      expect(signal.aborted).toBe(true); release(); await rejected;
    } finally { release(); await h.close(); }
  });
});

describe('Host 显式授权而非调用者自报', () => {
  it('主体、世代、定义、位置、期限及 grant revision 独立验证，回拨不复活过期能力', () => {
    let now = 100;
    const broker = new PermissionBroker(() => now, () => {});
    expect(() => broker.grant(request, 200)).toThrow('主体');
    broker.registerPrincipal(principal);
    const grant = broker.grant(request, 200);
    expect(broker.authorize(request)).toEqual({ allowed: true, grant });
    for (const drift of [{ principal_id: 'other' }, { host_id: 'other' }, { generation: 'old' }, { resource_revision: 'old' },
      { resource_id: 'other' }, { permission: 'secret.read' }, { target_location: 'remote' }]) expect(broker.authorize({ ...request, ...drift }).allowed).toBe(false);
    now = 201; expect(broker.authorize(request)).toEqual({ allowed: false, reason: 'permission_expired' });
    now = 101; expect(broker.isCurrent(grant)).toBe(false);
    expect(broker.revokeGrant(grant.grant_id)).toBe(true);
    now = 202; const next = broker.grant(request, 300);
    expect(next.permission_revision).not.toBe(grant.permission_revision);
    expect(broker.isCurrent({ ...next })).toBe(false);
    broker.revokePrincipal('worker'); expect(broker.isCurrent(next)).toBe(false);
  });
  it('审计失败不授予新权限，撤销失败报告也不继续放行', () => {
    let failure = false;
    const broker = new PermissionBroker(() => 100, () => { if (failure) throw new Error('audit unavailable'); });
    broker.registerPrincipal(principal); const grant = broker.grant(request, 200);
    failure = true; expect(() => broker.grant(request, 200)).toThrow('audit');
    expect(() => broker.revokeGrant(grant.grant_id)).toThrow('audit');
    expect(broker.isCurrent(grant)).toBe(false);
  });
});

it.each([
  { revokeDuringRead: false, revokeKnowledgeDuringRead: false },
  { revokeDuringRead: true, revokeKnowledgeDuringRead: false },
  { revokeDuringRead: false, revokeKnowledgeDuringRead: true },
])('实际 Host/生产 Worker/Resource/Knowledge/SSE/Log，全主体撤权=$revokeDuringRead，保存权限撤权=$revokeKnowledgeDuringRead', async ({ revokeDuringRead, revokeKnowledgeDuringRead }) => {
  const repository = path.resolve(__dirname, '../../..');
  const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-native-resource-'));
  const seeded = await promisify(execFile)('uv', ['run', '--project', 'apps/cognition-worker', '--extra', 'dev', 'python',
    'apps/cognition-worker/tests/test_rpc_roundtrip.py', '--host-production-seed', root], { cwd: repository, windowsHide: true });
  const input = JSON.parse(seeded.stdout);
  const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  const provider = createServer((request, response) => {
    let body = ''; request.setEncoding('utf8'); request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const payload = JSON.parse(body); requests.push(payload);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = payload.messages.some((message: { role: string }) => message.role === 'tool') ? { content: '已读取授权资料。' } : {
        tool_calls: [{ index: 0, id: 'resource-call', type: 'function', function: { name: 'glimmer_read_resource',
          arguments: JSON.stringify({ resource_id: 'document', arguments: {} }) } }],
      };
      response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta,
        finish_reason: 'tool_calls' in delta ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address() as { port: number };
  input.runtime_document.llm = { api_type: 'deepseek', api_key: 'fixture-only', base_url: `http://127.0.0.1:${address.port}`, models: { chat: 'fixture' } };
  input.runtime_document.memory.consolidation.enabled = false;
  const journal = new SqliteExecutionJournal(path.join(root, 'state/capabilities/execution.sqlite'));
  const execution = new ExecutionController(journal);
  const broker = new PermissionBroker(Date.now, () => {});
  let supervisor!: WorkerSupervisor;
  let receiver: ReturnType<WorkerSupervisor['createCognitionClient']> | undefined;
  const outbox = new ExecutionResultOutbox(journal, { accept: (event, signal) => {
    receiver ??= supervisor.createCognitionClient();
    return receiver.acceptExecutionResult(event, signal);
  } });
  const service = new HostResourceContributions({ host_id: 'host', target_location: 'host:local', permissions: broker,
    resources: new ResourceRegistry(), execution, outbox, on_principal_registered: value => {
      broker.grant({ ...request, principal_id: value.principal_id, generation: value.generation }, Date.now() + 30_000);
    } });
  let resourceReadCount = 0;
  let knowledgeGrant: ReturnType<PermissionBroker['grant']> | undefined;
  const reader = vi.fn(async () => {
    resourceReadCount++;
    if (revokeDuringRead) broker.revokePrincipal(`cognition:${supervisor.snapshot.generation}`);
    if (revokeKnowledgeDuringRead && resourceReadCount === 2) broker.revokeGrant(knowledgeGrant!.grant_id);
    return '真正授权的资料正文';
  }); service.registerResource(resource, reader);
  const actions: unknown[] = [];
  supervisor = new WorkerSupervisor({ ...input, app_root: repository, data_root: root, console_path: path.join(root, 'worker-console.log'),
    startup_timeout_ms: 15000, shutdown_timeout_ms: 3000, request_timeout_ms: 5000, capability_service: service,
    accept_state: async request => create(PublishStateResponseSchema, { operationId: request.call!.traceId, status: 'state_published' }),
    accept_action: async request => {
      actions.push(request); return create(PublishActionResponseSchema, { operationId: request.call!.idempotencyKey, status: 'action_published' });
    } });
  try {
    await supervisor.start();
    if (!revokeDuringRead) {
      const actualPrincipal = `cognition:${supervisor.snapshot.generation}`;
      knowledgeGrant = broker.grant({ ...request, principal_id: actualPrincipal, generation: supervisor.snapshot.generation!, permission: 'knowledge.ingest' }, Date.now() + 30_000);
      service.registerKnowledgeAccess(actualPrincipal, { ...knowledgePolicy, max_age_ms: 20_000 });
      const resourceScript = `
import asyncio, json, grpc
from dataclasses import asdict, replace
from pathlib import Path
from types import SimpleNamespace
from glimmer.capabilities.v1 import capabilities_pb2 as pb
from glimmer.common.v1 import service_contract_pb2 as common
from glimmer_cradle.cognition.ports import ResourceScope
from glimmer_cradle.cognition.adapters.persistence.sqlite_knowledge_store import SqliteKnowledgeStore
from glimmer_cradle.cognition.knowledge import KnowledgeIndex, KnowledgeResourceSource
from glimmer_cradle.cognition_worker.adapters.resource_client import ResourceClient
from glimmer_cradle.cognition_worker.rpc_service import KernelGrpcClient
async def run():
    transport = KernelGrpcClient(${JSON.stringify(supervisor.snapshot.generation)}, "fixture", bytearray())
    # 已由真实 Worker 注册的测试 generation；只附加测试 channel，不再次伪造 FD3 注册。
    transport._channel = grpc.aio.insecure_channel(${JSON.stringify(supervisor.snapshot.control_endpoint!.slice(7))})
    adapter = ResourceClient(transport, trace_id="knowledge-resource-proof")
    scope = ResourceScope("provider", "scene", "conversation")
    store = SqliteKnowledgeStore(Path(${JSON.stringify(root)}) / "state/cognition/knowledge.sqlite")
    noop = lambda *args, **kwargs: None
    observability = SimpleNamespace(logger=lambda _: SimpleNamespace(info=noop, warning=noop, debug=noop))
    index = KnowledgeIndex(observability=observability)
    index.bind_repository(store)
    index.bind_resource_port(adapter, principal_id=${JSON.stringify(actualPrincipal)})
    try:
        await store.connect()
        await index.register_resource_source(KnowledgeResourceSource("source:document", "document", "definition:1", scope))
        reference = await index.collect_resource("source:document")
        assert reference.revision == 1
        snapshot = (await store.get_all_entries())[0]["resource"].snapshot
        assert len(await index.get_knowledge(scope=scope)) == 1
        assert await index.get_knowledge(scope=ResourceScope("provider", "scene", "other")) == []
        assert await adapter.is_current(snapshot, principal_id=${JSON.stringify(actualPrincipal)}, scope=scope)
        assert not await adapter.is_current(replace(snapshot, content=b"forged"), principal_id=${JSON.stringify(actualPrincipal)}, scope=scope)
        assert not await adapter.is_current(replace(snapshot, media_type="application/json"), principal_id=${JSON.stringify(actualPrincipal)}, scope=scope)
        assert not await adapter.is_current(snapshot, principal_id="foreign", scope=scope)
        assert not await adapter.is_current(snapshot, principal_id=${JSON.stringify(actualPrincipal)}, scope=ResourceScope("provider", "scene", "other"))
        print(json.dumps({"body": snapshot.content.decode(), "access": asdict(snapshot.access), "revision": snapshot.revision}))
    finally:
        await store.close()
        await transport.stop()
asyncio.run(run())
`;
      const collected = await promisify(execFile)('uv', ['run', '--project', 'apps/cognition-worker', '--extra', 'dev', 'python', '-c', resourceScript],
        { cwd: repository, windowsHide: true, timeout: 30000 });
      const evidence = JSON.parse(collected.stdout);
      expect(evidence.body).toBe('真正授权的资料正文');
      expect((await service.validateKnowledgeResource(create(ValidateKnowledgeResourceRequestSchema, {
        call: { generation: supervisor.snapshot.generation!, traceId: 'knowledge-revocation' },
        access: { accessId: evidence.access.access_id, sourceId: evidence.access.source_id, principalId: actualPrincipal,
          permissionRevision: evidence.access.permission_revision, collectedAtMs: BigInt(evidence.access.collected_at_ms), expiresAtMs: BigInt(evidence.access.expires_at_ms) },
        reference: knowledgePolicy.reference, contentRevision: evidence.revision, mediaType: 'text/plain',
        scope: { sourceProviderId: 'provider', sceneId: 'scene', conversationId: 'conversation' },
      }), actualPrincipal, new AbortController().signal)).current).toBe(true);
      expect(journal.readOutbox(10)).toEqual([]);
    }
    const client = supervisor.createCognitionClient();
    const accepted = await client.submitPerception(create(SubmitPerceptionRequestSchema, {
      call: { traceId: 'host-resource-trace', idempotencyKey: 'host-resource-perception', causationId: 'perception-proof' },
      perceptionId: 'perception-proof', sensoryType: 'chat', source: 'fixture', timestampMs: Date.now(), familiarity: 1,
      addressMode: AddressMode.DIRECT, responsePolicy: ResponsePolicy.REPLY_ALLOWED, retentionCeiling: RetentionCeiling.EXPERIENCE,
      conversation: { sourceProviderId: 'provider', sceneId: 'scene', conversationId: 'conversation', continuityId: 'continuity',
        threadId: 'main', interactionId: 'host-resource-turn', recallScope: 'conversation_private', disclosureScope: 'conversation_private' },
      origin: { providerKind: 'core', providerId: 'provider', sourceEventId: 'host-resource-event', schemaRef: 'fixture',
        trustTier: 'host_verified', privacyClass: 'private', cognitiveEffect: 'observation' },
      content: { text: '读取实际 Host 资料', actorId: 'reader-user' },
    }));
    const deadline = Date.now() + 10000;
    let state;
    do {
      state = await client.perceptionOperation(create(GetPerceptionOperationRequestSchema, { operationId: accepted.operationId }));
      if (state.terminal) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    expect(state).toMatchObject({ state: revokeDuringRead || revokeKnowledgeDuringRead ? PerceptionOperationState.FAILED : PerceptionOperationState.SUCCEEDED, terminal: true });
    if (revokeDuringRead) {
      expect(reader).toHaveBeenCalledOnce(); expect(actions).toHaveLength(0); expect(requests).toHaveLength(1);
      expect(JSON.stringify(requests)).not.toContain('真正授权的资料正文');
      expect(journal.readOutbox(10)).toHaveLength(1);
      expect(journal.readOutbox(10)[0].invocation.state).toBe('succeeded');
      return;
    }
    if (revokeKnowledgeDuringRead) {
      expect(reader).toHaveBeenCalledTimes(2); expect(actions).toHaveLength(0); expect(requests).toHaveLength(1);
      expect(JSON.stringify(requests[0])).toContain('真正授权的资料正文');
      expect(journal.readOutbox(10)).toEqual([]);
      const inspectKnowledge = `
import sqlite3
with sqlite3.connect(${JSON.stringify(path.join(root, 'state/cognition/knowledge.sqlite'))}) as db:
    assert db.execute("SELECT enabled,deleted_at IS NOT NULL FROM knowledge_entry WHERE source='resource'").fetchone() == (0, 1)
    assert db.execute("SELECT COUNT(*) FROM knowledge_resource_revision").fetchone() == (1,)
    assert db.execute("SELECT COUNT(*) FROM knowledge_embedding").fetchone() == (0,)
`;
      await promisify(execFile)('uv', ['run', '--project', 'apps/cognition-worker', '--extra', 'dev', 'python', '-c', inspectKnowledge],
        { cwd: repository, windowsHide: true, timeout: 30000 });
      return;
    }
    expect(reader).toHaveBeenCalledTimes(2); expect(actions).toHaveLength(1); expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[0])).toContain('真正授权的资料正文');
    expect(JSON.stringify(requests[0])).toContain('whole-resource.v1');
    expect(JSON.stringify(requests[1].messages.find(message => message.role === 'tool'))).toContain('真正授权的资料正文');
    expect(journal.readOutbox(10)).toEqual([]);
    await supervisor.stop();
    const readLog = `
import asyncio, json
from types import SimpleNamespace
from pathlib import Path
from glimmer_cradle.conversation import build_conversation_recorder
from glimmer_cradle.cognition_worker.composition import SystemClock, SystemIdGenerator
noop = lambda *args, **kwargs: None
async def read():
    recorder = build_conversation_recorder(Path(${JSON.stringify(root)}) / "state/cognition/experience",
        clock=SystemClock(), ids=SystemIdGenerator(), observability=SimpleNamespace(logger=lambda _: SimpleNamespace(info=noop, warning=noop, error=noop), current_trace_id=lambda: None))
    await recorder.start()
    try:
        print(json.dumps([{ "id": m.moment_id, "kind": m.kind, "causes": list(m.causation_ids), "content": m.content }
            for m in recorder.iter_moments_since(None) if m.interaction_id == "host-resource-turn"], ensure_ascii=False))
    finally: await recorder.stop()
asyncio.run(read())
`;
    const log = await promisify(execFile)('uv', ['run', '--project', 'apps/cognition-worker', '--extra', 'dev', 'python', '-c', readLog],
      { cwd: repository, windowsHide: true, timeout: 30000 });
    const moments = JSON.parse(log.stdout) as Array<{ id: string; kind: string; causes: string[]; content: Record<string, unknown> }>;
    const action = moments.find(moment => moment.kind === 'action')!;
    const result = moments.find(moment => moment.kind === 'action_result')!;
    expect(result.content.source_fact_id).toBe(action.id);
    expect(moments.find(moment => moment.kind === 'reply')!.causes).toContain(result.id);
    expect(JSON.stringify(result.content)).toContain('真正授权的资料正文');
  } finally {
    await supervisor.stop(); await service.stop(); journal.close();
    provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve()));
  }
}, 60000);

describe('Host Resource 派发与撤销', () => {
  it('停止时审计失败也撤销所有主体，重复停止可以收束', async () => {
    const h = harness();
    h.service.activatePrincipal('second', 'generation');
    const grant = h.broker.grant(request, 300);
    const second = h.broker.grant({ ...request, principal_id: 'second' }, 300);
    h.audit.mockImplementation(() => { throw new Error('audit unavailable'); });
    try {
      await expect(h.service.stop()).rejects.toThrow('停止清理');
      expect(h.broker.isCurrent(grant)).toBe(false); expect(h.broker.isCurrent(second)).toBe(false);
      await expect(h.service.stop()).resolves.toBeUndefined();
      expect(() => h.service.activatePrincipal('next', 'generation')).toThrow('停止');
    } finally { h.journal.close(); }
  });
  it('缺 grant/用户自报/scope 越界拒绝；实际 grant 经独立目录读取，重复不派发', async () => {
    const h = harness();
    try {
      expect((await h.expose()).resources).toEqual([]);
      await expect(h.expose({ call: { generation: 'old', traceId: 'trace' } })).rejects.toThrow('身份');
      await expect(h.read()).rejects.toThrow('未曝光');
      h.broker.grant(request, 300);
      // 同一 Step 不因晚授予权限而改变已捕获快照。
      expect((await h.expose()).resources).toEqual([]);
      await h.expose({ runId: 'next' });
      await expect(h.expose({ runId: 'user', scope: { sourceProviderId: 'provider', sceneId: 'scene', conversationId: 'conversation', userId: 'forged-user' } })).rejects.toThrow('用户');
      const wrong = await h.expose({ runId: 'scope', scope: { sourceProviderId: 'provider', sceneId: 'scene', conversationId: 'other' } });
      expect(wrong.resources).toEqual([]);
      const override = { runId: 'next', call: { generation: 'generation', traceId: 'trace', idempotencyKey: 'next:call' } };
      const first = await h.read(override); const replay = await h.read(override);
      expect(first).toEqual(replay); expect(h.reader).toHaveBeenCalledOnce(); expect(h.journal.readOutbox(10)).toEqual([]);
      await expect(h.read({ ...override, sourceFactId: 'foreign-fact' })).rejects.toThrow('摘要');
      expect(h.reader).toHaveBeenCalledOnce();
    } finally { await h.close(); }
  });
  it.each(['grant', 'principal', 'resource', 'definition', 'expiry'] as const)('等待编码/读取期间 %s 失效，晚到正文只确认执行不暴露', async change => {
    const h = harness(); let release!: () => void;
    let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reader = async () => { enter(); await gate; return '撤销后迟到正文'; };
    h.service.revokeResource('document', 'reader-owner'); h.service.registerResource(resource, reader);
    const grant = h.broker.grant(request, 300); await h.expose();
    const reading = h.read();
    const rejected = expect(reading).rejects.toThrow();
    await entered;
    if (change === 'grant') h.broker.revokeGrant(grant.grant_id);
    else if (change === 'principal') h.service.revokePrincipal('worker');
    else if (change === 'resource') h.service.revokeResource('document', 'reader-owner');
    else if (change === 'definition') h.service.registerResource({ ...resource, revision: 'definition:2' }, async () => '新正文');
    else h.time(301);
    release(); await rejected;
    try {
      expect(h.journal.load('run:call')?.state).toBe('succeeded');
      expect(h.journal.readOutbox(10)).toHaveLength(1);
    } finally { await h.close(); }
  });
  it('真实 reader 异常保持 unknown；接纳响应丢失只重投 outbox，不重读资源', async () => {
    let failReceipt = true;
    const h = harness({ accept: async event => {
      if (failReceipt) throw new Error('receipt lost');
      return { event_id: event.event_id, invocation_id: event.invocation.invocation_id, revision: event.invocation.revision, accepted: true };
    } });
    h.broker.grant(request, 300); await h.expose();
    try {
      await expect(h.read()).rejects.toThrow('receipt');
      expect(h.journal.load('run:call')?.state).toBe('succeeded');
      failReceipt = false; await h.read(); expect(h.reader).toHaveBeenCalledOnce();
      h.service.revokeResource('document', 'reader-owner');
      h.service.registerResource({ ...resource, revision: 'definition:2' }, async () => { throw new Error('unknown external read'); });
      h.broker.grant({ ...request, resource_revision: 'definition:2' }, 300);
      await h.expose({ runId: 'unknown' });
      const unknown = { runId: 'unknown', call: { generation: 'generation', traceId: 'trace', idempotencyKey: 'unknown:call' }, reference: { id: 'document', revision: 'definition:2' } };
      await expect(h.read(unknown)).rejects.toBeInstanceOf(ExecutionRecoveryRequiredError);
      await expect(h.read(unknown)).rejects.toBeInstanceOf(ExecutionRecoveryRequiredError);
      expect(h.journal.load('unknown:call')?.state).toBe('unknown');
    } finally { await h.close(); }
  });
});
