import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecutionController, SqliteExecutionJournal, type StepExposureRequest } from '@glimmer-cradle/capabilities';
import type { Observability } from '@glimmer-cradle/platform/observability';
import { CapabilityCatalogAdapter } from '../../adapters/skill-plane/capability-catalog-adapter';
import { SkillInvocationGateway } from '../skill-plane/skill-invocation-gateway';
import { SkillPolicyEngine } from '../skill-plane/skill-policy-engine';
import { NativeCapabilityAppService } from './native-capability-app.service';

const observability: Observability = {
  logger: () => ({ debug() {}, info() {}, warn() {}, error() {}, critical() {} }),
  createTraceContext: traceId => ({ trace_id: traceId ?? 'trace' }), currentTraceId: () => undefined,
  withTrace: async (_trace, operation) => operation(), span: async (_name, operation) => operation({ setAttribute() {}, setStatus() {} }),
  histogram() {}, counter() {}, start() {}, stop() {}, close: async () => undefined,
};
const roots: string[] = [];
const journals: SqliteExecutionJournal[] = [];
afterEach(() => { for (const journal of journals.splice(0)) journal.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true }); });
function fixture(confirmationRequired = false) {
  const root = mkdtempSync(join(tmpdir(), 'glimmer-native-capability-')); roots.push(root);
  const journal = new SqliteExecutionJournal(join(root, 'execution.sqlite')); journals.push(journal);
  const catalog = new CapabilityCatalogAdapter();
  const handler = vi.fn(async () => ({ condition: 'sunny' }));
  const definition = { id: 'weather', name: '天气', description: '天气', provider: { kind: 'core' as const, id: 'weather-owner' },
    policy: { riskLevel: 'low' as const, confirmationRequired, sideEffects: ['external'], audit: true },
    tools: [{ name: 'lookup', description: '天气', parameters: { type: 'object' }, handler }],
    prompts: [{ id: 'method', description: '方法', template: '不进入 Tool 目录的正文' }],
    resources: [{ id: 'resource', description: '资源', read: () => '资源' }] };
  catalog.registerSkill(definition);
  const policy = new SkillPolicyEngine();
  const confirm = vi.fn(async () => false);
  const gateway = new SkillInvocationGateway(catalog, policy, { record() {} }, observability, { record() {} }, confirm, new ExecutionController(journal));
  const service = new NativeCapabilityAppService(catalog, gateway, policy, 'host:test');
  const request: StepExposureRequest = { run_id: 'run', step: 1, principal_id: 'cognition:1', target_location: 'untrusted-input',
    protocol_features: ['tool-call.v1', 'capability-read.v1'], scope: { conversation_id: 'conversation', scene_id: 'scene', source_provider_id: 'provider' },
    budget: { max_definitions: 128, max_definition_bytes: 65536, remaining_tool_calls: 1 } };
  const surface = service.exposeStep(request);
  const tool = surface.tools[0]!;
  const invocation = { run_id: 'run', step: 1, principal_id: request.principal_id, call_id: 'call', name: tool.name,
    reference: tool.reference, scope: request.scope!, arguments: {}, source_fact_id: 'actual-action', invocation_id: 'run:call' };
  return { service, catalog, definition, journal, handler, request, surface, invocation, confirm };
}
describe('NativeCapabilityAppService', () => {
  it('动态 reader 使用真实参数和正文，Schema 失败不派发；确认拒绝与未知结果不重跑', async () => {
    const f = fixture(); const render = vi.fn(async (args: unknown) => `实际正文:${(args as { topic: string }).topic}`);
    f.catalog.registerSkill({ ...f.definition, prompts: [{ id: 'method', description: '摘要不是正文', template: '摘要不是正文',
      parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'], additionalProperties: false }, render }] });
    const surface = f.service.exposeStep({ ...f.request, step: 2 }); const method = surface.skills[0]!;
    const request = { ...f.invocation, step: 2, reference: { id: method.reference.skill_id, revision: method.reference.definition_revision }, name: 'glimmer_load_skill' };
    await expect(f.service.readCapability('skill', request, 'trace', new AbortController().signal)).rejects.toThrow('参数');
    expect(render).not.toHaveBeenCalled(); expect(f.journal.load('run:call')).toBeNull();
    const success = await f.service.readCapability('skill', { ...request, arguments: { topic: '资料' } }, 'trace', new AbortController().signal);
    expect(success.result).toMatchObject({ instructions: '实际正文:资料' }); expect(render).toHaveBeenCalledOnce();
    const denied = fixture(true); const readDenied = () => denied.service.readCapability('resource', {
      ...denied.invocation, reference: denied.surface.resources[0]!.reference }, 'trace', new AbortController().signal);
    const result = await readDenied(); expect(result).toMatchObject({ state: 'failed', error: 'authorization_denied' });
    await expect(readDenied()).resolves.toEqual(result); expect(denied.confirm).toHaveBeenCalledOnce();
    const unknown = fixture(); const read = vi.fn(async () => { throw new Error('receiver disconnected'); });
    unknown.catalog.registerSkill({ ...unknown.definition, resources: [{ id: 'resource', description: '资源', read }] });
    const snapshot = unknown.service.exposeStep({ ...unknown.request, step: 2 });
    const uncertain = () => unknown.service.readCapability('resource', { ...unknown.invocation, step: 2, reference: snapshot.resources[0]!.reference }, 'trace', new AbortController().signal);
    await expect(uncertain()).rejects.toMatchObject({ name: 'SkillInvocationRecoveryRequiredError' });
    await expect(uncertain()).rejects.toMatchObject({ name: 'SkillInvocationRecoveryRequiredError' });
    expect(read).toHaveBeenCalledOnce(); expect(unknown.journal.load('run:call')?.state).toBe('unknown');
  });
  it.each(['skill', 'resource'] as const)('%s 从独立目录加载，持久重放、共用预算与跨类型身份隔离', async kind => {
    const f = fixture();
    const reference = kind === 'skill' ? { id: f.surface.skills[0]!.reference.skill_id, revision: f.surface.skills[0]!.reference.definition_revision }
      : f.surface.resources[0]!.reference;
    const request = { ...f.invocation, reference, name: `glimmer_${kind}` };
    const read = () => f.service.readCapability(kind, request, 'trace', new AbortController().signal);
    const first = await read();
    expect(first.state).toBe('succeeded');
    expect(first.result).toMatchObject(kind === 'skill' ? { instructions: '不进入 Tool 目录的正文' } : { content_utf8: '资源', content_revision: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(f.journal.load('run:call')?.target.capability_id).toBe(`${kind}:${reference.id}`);
    await expect(read()).resolves.toEqual(first);
    await expect(f.service.invokeTool(f.invocation, 'trace', new AbortController().signal)).rejects.toThrow('冲突');
    await expect(f.service.invokeTool({ ...f.invocation, call_id: 'other', invocation_id: 'run:other' }, 'trace', new AbortController().signal)).rejects.toThrow('budget');
    expect(f.handler).not.toHaveBeenCalled();
  });
  it.each(['skill', 'resource'] as const)('%s 读取仍复验撤销、scope、版本与协议支持', async kind => {
    const f = fixture();
    const reference = kind === 'skill' ? { id: f.surface.skills[0]!.reference.skill_id, revision: f.surface.skills[0]!.reference.definition_revision }
      : f.surface.resources[0]!.reference;
    expect(f.service.exposeStep({ ...f.request, step: 2, protocol_features: ['tool-call.v1'] })[kind === 'skill' ? 'skills' : 'resources']).toEqual([]);
    await expect(f.service.readCapability(kind, { ...f.invocation, reference: { ...reference, revision: 'stale' } }, 'trace', new AbortController().signal)).rejects.toThrow('版本');
    f.catalog.unregisterSkill('weather');
    await expect(f.service.readCapability(kind, { ...f.invocation, reference }, 'trace', new AbortController().signal)).rejects.toThrow('撤销');
    expect(f.journal.load('run:call')).toBeNull();
  });
  it('三类独立曝光，真实 journal 幂等重放且不重复副作用', async () => {
    const f = fixture();
    expect([f.surface.tools.length, f.surface.skills.length, f.surface.resources.length]).toEqual([1, 1, 1]);
    expect(JSON.stringify(f.surface)).not.toContain('不进入 Tool 目录的正文');
    const invoke = () => f.service.invokeTool(f.invocation, 'trace', new AbortController().signal);
    const [first, concurrent] = await Promise.all([invoke(), invoke()]);
    expect(first).toEqual(concurrent);
    expect(first).toMatchObject({ state: 'succeeded', result: { condition: 'sunny' } });
    expect(first.result_event_id).toHaveLength(64);
    expect(f.journal.load('run:call')?.interaction).toEqual({ conversation_id: 'conversation', source_fact_id: 'actual-action' });
    await expect(invoke()).resolves.toEqual(first);
    expect(f.handler).toHaveBeenCalledOnce();
    await expect(f.service.invokeTool({ ...f.invocation, arguments: { changed: true } }, 'trace', new AbortController().signal)).rejects.toThrow('冲突');
    await expect(f.service.invokeTool({ ...f.invocation, call_id: 'other', invocation_id: 'run:other' }, 'trace', new AbortController().signal)).rejects.toThrow('budget');
  });
  it.each(['revision', 'revocation', 'principal', 'scope', 'cancel'] as const)('%s 失效不派发', async failure => {
    const f = fixture(); const abort = new AbortController(); let invocation = f.invocation;
    if (failure === 'revision') f.catalog.registerSkill({ ...f.definition, tools: [{ ...f.definition.tools[0]!, description: '新版本' }] });
    if (failure === 'revocation') f.catalog.unregisterSkill('weather');
    if (failure === 'principal') f.service.revokePrincipal(f.request.principal_id);
    if (failure === 'scope') invocation = { ...invocation, scope: { ...invocation.scope, conversation_id: 'other' } };
    if (failure === 'cancel') abort.abort(new Error('cancel'));
    await expect(f.service.invokeTool(invocation, 'trace', abort.signal)).rejects.toThrow();
    expect(f.handler).not.toHaveBeenCalled(); expect(f.journal.load('run:call')).toBeNull();
  });
  it('Step context 冻结、协议缺失不曝光 Tool，下一 Step 使用新版本', () => {
    const f = fixture(); (f.request.scope as { conversation_id: string }).conversation_id = 'mutated';
    expect(() => f.service.exposeStep(f.request)).toThrow('context');
    f.catalog.registerSkill({ ...f.definition, tools: [{ ...f.definition.tools[0]!, description: '新版本' }] });
    const next = f.service.exposeStep({ ...f.request, step: 2 });
    expect(next.tools[0]!.reference.revision).not.toBe(f.surface.tools[0]!.reference.revision);
    expect(f.service.exposeStep({ ...f.request, step: 3, protocol_features: [] }).tools).toEqual([]);
  });
  it('Worker 自报 User 不形成 Host 授权事实', () => {
    const f = fixture();
    expect(() => f.service.exposeStep({ ...f.request, step: 2, user_id: 'claimed-user', scope: { ...f.request.scope!, user_id: 'claimed-user' } })).toThrow('Host 解析');
    expect(f.handler).not.toHaveBeenCalled();
  });
  it('持久确认拒绝是已知 failed；未知派发要求恢复，不重跑', async () => {
    const denied = fixture(true);
    const invoke = () => denied.service.invokeTool(denied.invocation, 'trace', new AbortController().signal);
    const result = await invoke();
    expect(result).toMatchObject({ state: 'failed', error: 'authorization_denied' });
    expect(result.result_event_id).toHaveLength(64);
    await expect(invoke()).resolves.toEqual(result);
    expect(denied.confirm).toHaveBeenCalledOnce(); expect(denied.handler).not.toHaveBeenCalled();
    const unknown = fixture(); unknown.handler.mockRejectedValueOnce(new Error('receiver disconnected'));
    const uncertain = () => unknown.service.invokeTool(unknown.invocation, 'trace', new AbortController().signal);
    await expect(uncertain()).rejects.toMatchObject({ name: 'SkillInvocationRecoveryRequiredError' });
    await expect(uncertain()).rejects.toMatchObject({ name: 'SkillInvocationRecoveryRequiredError' });
    expect(unknown.journal.load('run:call')?.state).toBe('unknown'); expect(unknown.handler).toHaveBeenCalledOnce();
  });
});
