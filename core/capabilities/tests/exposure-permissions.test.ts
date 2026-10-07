import { describe, expect, it } from 'vitest';
import { GLOBAL_CAPABILITY_SCOPE, isCapabilityScopeVisible, isCapabilityDefinitionVisible,
  ToolRegistry, ResourceRegistry, SkillCatalog, ExposureController, type StepExposureRequest, type ExposureGrant,
  type CapabilityScope, type Tool, type Resource, type Skill, resourceContentFromValue } from '../src/index.js';

const context = { source_provider_id: 'provider:one', scene_id: 'scene:one', conversation_id: 'conversation:one' };

describe('能力 scope 曝光', () => {
  it('缺省保持 global，共享缺省不可变且不需要上下文', () => {
    expect(isCapabilityScopeVisible(undefined, undefined)).toBe(true);
    expect(isCapabilityScopeVisible(GLOBAL_CAPABILITY_SCOPE, undefined)).toBe(true);
    expect(Object.isFrozen(GLOBAL_CAPABILITY_SCOPE)).toBe(true);
    expect(Reflect.set(GLOBAL_CAPABILITY_SCOPE, 'kind', 'scene')).toBe(false);
  });

  it.each(['source_provider', 'scene', 'conversation'] as const)('%s 只匹配自身身份域而不跨域猜测', kind => {
    const key = kind === 'source_provider' ? 'source_provider_id' : kind === 'scene' ? 'scene_id' : 'conversation_id';
    expect(isCapabilityScopeVisible({ kind, ids: [context[key]] }, context)).toBe(true);
    expect(isCapabilityScopeVisible({ kind, ids: ['other', context[key]] }, context)).toBe(true);
    expect(isCapabilityScopeVisible({ kind, ids: ['foreign'] }, context)).toBe(false);
    expect(isCapabilityScopeVisible({ kind, ids: [context[key]] }, undefined)).toBe(false);
    const foreignKey = kind === 'conversation' ? 'scene_id' : 'conversation_id';
    expect(isCapabilityScopeVisible({ kind, ids: [context[foreignKey]] }, context)).toBe(false);
  });

  it('父贡献和目标 scope 各自满足，不能以任一 global 解除另一限制', () => {
    const parent: CapabilityScope = { kind: 'source_provider', ids: ['provider:one'] };
    const target: CapabilityScope = { kind: 'conversation', ids: ['conversation:private'] };
    const visible = (scope: CapabilityScope) => isCapabilityScopeVisible(scope, context);
    expect(visible(parent) && visible(target)).toBe(false);
    expect(visible(GLOBAL_CAPABILITY_SCOPE) && visible(target)).toBe(false);
    expect(visible(parent) && visible(GLOBAL_CAPABILITY_SCOPE)).toBe(true);
  });

  it('非法和未知 kind 失败关闭，不偷换成 conversation 或缺省 global', () => {
    for (const malformed of [null, { kind: 'unknown', ids: [context.conversation_id] },
      { kind: 'conversation' }, { kind: 'conversation', ids: [] },
      { kind: 'conversation', ids: [context.conversation_id, ' '] },
      { kind: 'conversation', ids: [context.conversation_id, 1] }]) {
      expect(isCapabilityScopeVisible(malformed as CapabilityScope, context)).toBe(false);
    }
  });

  it('不解析扩展 $self，也不修改 caller 的 scope', () => {
    const scope: CapabilityScope = { kind: 'source_provider', ids: ['$self'] };
    expect(isCapabilityScopeVisible(scope, context)).toBe(false);
    expect(scope).toEqual({ kind: 'source_provider', ids: ['$self'] });
    expect(isCapabilityScopeVisible(scope, { ...context, source_provider_id: '$self' })).toBe(true);
  });
});

const base = { id: 'one', owner_id: 'owner', revision: '1', name: 'one', description: '定义',
  audience: 'character', readiness: 'ready' as const, scopes: [GLOBAL_CAPABILITY_SCOPE] };
const tool: Tool = { ...base, executor_id: 'executor', input_schema: { type: 'object' } };
const resource: Resource = { ...base, reader_id: 'reader', input_schema: null };
const skill: Skill = { ...base, instructions: { kind: 'inline', text: '方法材料，不授予权限。' } };

describe('每 Step 的有界三类 Exposure', () => {
  const request: StepExposureRequest = { run_id: 'run', step: 1, principal_id: 'cognition', user_id: 'user:one',
    target_location: 'host:one', scope: { ...context, user_id: 'user:one' }, protocol_features: ['tool-call.v1'],
    budget: { max_definitions: 3, max_definition_bytes: 8192, remaining_tool_calls: 2 } };
  const grants: ExposureGrant[] = (['tool', 'skill', 'resource'] as const).map(kind => ({ kind,
    reference: { id: 'one', revision: '1' }, principal_id: 'cognition', user_id: 'user:one',
    target_location: 'host:one', permission_revision: 'permission:1', required_protocol_features: ['tool-call.v1'] }));
  function fixture() {
    const tools = new ToolRegistry(); const methods = new SkillCatalog(); const resources = new ResourceRegistry();
    tools.register(tool); methods.register(skill); resources.register(resource);
    return { tools, methods, resources, exposure: new ExposureController(tools, methods, resources) };
  }
  it('独立集合、无正文/handler，缺少授权不会从注册推断许可，投影深冻结', () => {
    const { exposure } = fixture(); expect(exposure.expose(request, []).tools).toEqual([]);
    const surface = exposure.expose(request, grants);
    expect([surface.tools.length, surface.skills.length, surface.resources.length]).toEqual([1, 1, 1]);
    expect(surface.skills[0]).not.toHaveProperty('instructions');
    expect(surface.tools[0].name).toMatch(/^tool_[a-f0-9]{56}$/);
    expect(Object.isFrozen(surface.tools[0].reference)).toBe(true);
    expect(Object.isFrozen(surface.tools[0].input_schema)).toBe(true);
    expect(surface.used_definition_bytes).toBeGreaterThan(0);
  });
  it.each(['principal', 'user', 'location', 'protocol', 'revision', 'permission'])( '%s 事实不匹配则失败关闭', kind => {
    const bad = grants.map(grant => ({ ...grant,
      ...(kind === 'principal' ? { principal_id: 'foreign' } : {}), ...(kind === 'user' ? { user_id: 'foreign' } : {}),
      ...(kind === 'location' ? { target_location: 'remote' } : {}), ...(kind === 'protocol' ? { required_protocol_features: ['unsupported'] } : {}),
      ...(kind === 'revision' ? { reference: { id: 'one', revision: 'old' } } : {}), ...(kind === 'permission' ? { permission_revision: '' } : {}) }));
    const surface = fixture().exposure.expose(request, bad);
    expect(surface.tools).toEqual([]); expect(surface.skills).toEqual([]); expect(surface.resources).toEqual([]);
  });
  it('新 Step 复验权限/版本/来源，与旧冻结快照独立；用户 scope 不跨主体', () => {
    const { tools, exposure } = fixture(); const previous = exposure.expose(request, grants);
    tools.register({ ...tool, revision: '2', scopes: [{ kind: 'user', ids: ['foreign'] }] });
    expect(exposure.expose({ ...request, step: 2 }, grants).tools).toEqual([]);
    expect(previous.tools[0].reference.revision).toBe('1');
    tools.register({ ...tool, revision: '3', readiness: 'degraded' });
    expect(exposure.expose(request, grants).tools).toEqual([]);
    expect(() => exposure.expose({ ...request, user_id: 'foreign' }, grants)).toThrow('user scope');
  });
  it('零预算、定义数量、真实 UTF-8 字节与缺失/非法预算不能绕过', () => {
    const { exposure } = fixture();
    expect(exposure.expose({ ...request, budget: { ...request.budget, max_definitions: 0 } }, grants).truncated).toBe(true);
    const full = exposure.expose(request, grants);
    const bounded = exposure.expose({ ...request, budget: { ...request.budget, max_definition_bytes: full.used_definition_bytes - 1 } }, grants);
    expect(bounded.truncated).toBe(true); expect(bounded.resources).toEqual([]);
    expect(exposure.expose({ ...request, budget: { ...request.budget, remaining_tool_calls: 0 } }, grants).tools).toEqual([]);
    for (const budget of [{}, { ...request.budget, max_definitions: -1 }, { ...request.budget, max_definition_bytes: NaN }]) {
      expect(() => exposure.expose({ ...request, budget: budget as StepExposureRequest['budget'] }, grants)).toThrow('budget');
    }
  });
});

describe('Tool / Resource / Skill 独立 owner', () => {
  it('资源内容版本来自实际 UTF-8/规范 JSON，不等于定义版本或不可序列化平台对象', () => {
    const reference = { id: 'resource', revision: 'definition1' };
    const text = resourceContentFromValue(reference, '资源');
    expect(text).toMatchObject({ reference, media_type: 'text/plain', content_utf8: '资源', content_revision: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(resourceContentFromValue({ ...reference, revision: 'definition2' }, '资源').content_revision).toBe(text.content_revision);
    expect(resourceContentFromValue(reference, '新资源').content_revision).not.toBe(text.content_revision);
    expect(resourceContentFromValue(reference, { b: 1, a: '资料' })).toEqual(resourceContentFromValue(reference, { a: '资料', b: 1 }));
    for (const invalid of [undefined, new Date(), { invalid: NaN }, { get content() { throw new Error('must not run'); } }]) {
      expect(() => resourceContentFromValue(reference, invalid)).toThrow();
    }
    expect(() => resourceContentFromValue(reference, '资'.repeat(11000))).toThrow('预算');
    expect(resourceContentFromValue(reference, '')).toMatchObject({ content_utf8: '' });
  });
  it('动态方法只曝光参数 Schema，不将摘要当正文或额外 Tool', () => {
    const methods = new SkillCatalog(); const tools = new ToolRegistry(); const resources = new ResourceRegistry();
    methods.register({ ...skill, instructions: { kind: 'reader', reader_id: 'reader', input_schema: { type: 'object', required: ['topic'] } } });
    const surface = new ExposureController(tools, methods, resources).expose({ run_id: 'run', step: 1, principal_id: 'principal', target_location: 'host',
      protocol_features: ['capability-read.v1'], budget: { max_definitions: 3, max_definition_bytes: 8192, remaining_tool_calls: 1 } },
      [{ kind: 'skill', reference: { id: skill.id, revision: skill.revision }, principal_id: 'principal', target_location: 'host', permission_revision: '1', required_protocol_features: ['capability-read.v1'] }]);
    expect(surface.tools).toEqual([]); expect(surface.skills[0].input_schema).toEqual({ type: 'object', required: ['topic'] });
    expect(surface.skills[0]).not.toHaveProperty('instructions');
  });
  it('方法发现只给摘要，正文按 revision/scope/readiness 重新读取，撤销后旧引用失效', () => {
    const methods = new SkillCatalog(); methods.register(skill);
    const summary = methods.inlineSummaries(context)[0];
    expect(summary).not.toHaveProperty('instructions');
    expect(Object.isFrozen(summary.reference)).toBe(true);
    expect(methods.inlineMaterial(summary.reference, context)?.instructions).toBe(skill.instructions.kind === 'inline' ? skill.instructions.text : '');
    methods.register({ ...skill, revision: '2', scopes: [{ kind: 'conversation', ids: ['private'] }] });
    expect(methods.inlineMaterial(summary.reference, context)).toBeUndefined();
    expect(methods.inlineSummaries(context)).toEqual([]);
    methods.register({ ...skill, revision: '3', readiness: 'degraded' });
    expect(methods.inlineMaterial({ skill_id: skill.id, definition_revision: '3' }, context)).toBeUndefined();
    methods.register({ ...skill, revision: '4', instructions: { kind: 'reader', reader_id: 'reader', input_schema: {} } });
    expect(methods.inlineSummaries(context)).toEqual([]);
    expect(methods.inlineMaterial({ skill_id: skill.id, definition_revision: '4' }, context)).toBeUndefined();
  });
  it('三类允许同 ID，无 Tool 父 Skill；分别撤销而不互相删除', () => {
    const tools = new ToolRegistry(); const resources = new ResourceRegistry(); const methods = new SkillCatalog();
    tools.register(tool); resources.register(resource); methods.register(skill);
    expect(methods.get('one')).not.toHaveProperty('tools');
    expect(tools.get('one')).not.toHaveProperty('instructions');
    tools.revoke('one', 'owner');
    expect(tools.list()).toEqual([]); expect(resources.list()).toHaveLength(1); expect(methods.list()).toHaveLength(1);
  });

  it.each(['tool', 'resource', 'skill'] as const)('%s 注册/替换/撤销保护 owner、revision 和旧引用', kind => {
    const registry = kind === 'tool' ? new ToolRegistry() : kind === 'resource' ? new ResourceRegistry() : new SkillCatalog();
    // 只供参数化测试，生产 API 保持三个不同类型，不能混用定义。
    const register = (definition: unknown) => registry.register(definition as Tool & Resource & Skill);
    const definition = kind === 'tool' ? tool : kind === 'resource' ? resource : skill;
    const initial = register(definition);
    expect(register(definition)).toBe(initial);
    expect(() => register({ ...definition, owner_id: 'other', revision: '2' })).toThrow('owner');
    expect(() => register({ ...definition, description: '偷偷改写' })).toThrow('revision');
    expect(() => registry.revoke('one', 'other')).toThrow('owner');
    expect(registry.get('one')).toBe(initial);
    const replacement = register({ ...definition, revision: '2', readiness: 'degraded' });
    expect(replacement).not.toBe(initial); expect(initial.readiness).toBe('ready');
    expect(registry.revoke('one', 'owner', '1')).toBe(false);
    expect(registry.get('one')).toBe(replacement);
    expect(registry.revoke('one', 'owner', '2')).toBe(true);
    expect(registry.revoke('one', 'owner')).toBe(false);
  });

  it('深冻结调用方定义与列表，原对象修改不改变注册事实', () => {
    const tools = new ToolRegistry();
    const input = { ...tool, scopes: [{ kind: 'conversation' as const, ids: ['conversation:one'] as [string] }],
      input_schema: { type: 'object', properties: { query: { type: 'string' } } } };
    const stored = tools.register(input);
    input.scopes[0].ids[0] = 'foreign'; input.input_schema.properties.query.type = 'number';
    expect(isCapabilityDefinitionVisible(stored, context)).toBe(true);
    expect(stored.input_schema).toMatchObject({ properties: { query: { type: 'string' } } });
    expect(Object.isFrozen(stored.scopes[0])).toBe(true);
    expect(Object.isFrozen((stored.input_schema as typeof input.input_schema).properties.query)).toBe(true);
    expect(Object.isFrozen(tools.list())).toBe(true);
    expect(Reflect.set(stored, 'readiness', 'unavailable')).toBe(false);
  });

  it('独立 readiness/audience 与多 scope 交集，不把 global 当作解除父限制', () => {
    expect(isCapabilityDefinitionVisible(tool, context)).toBe(true);
    for (const readiness of ['contract_only', 'degraded', 'unavailable'] as const) {
      expect(isCapabilityDefinitionVisible({ ...tool, readiness }, context)).toBe(false);
    }
    expect(isCapabilityDefinitionVisible({ ...tool, audience: 'host' }, context)).toBe(false);
    expect(isCapabilityDefinitionVisible({ ...tool, scopes: [GLOBAL_CAPABILITY_SCOPE,
      { kind: 'conversation', ids: ['foreign'] }] }, context)).toBe(false);
  });

  it('坏 scope、空引用、非 JSON 和方法正文失败关闭，不污染有效集合', () => {
    const tools = new ToolRegistry(); tools.register(tool);
    for (const bad of [{ ...tool, scopes: [] }, { ...tool, executor_id: '' },
      { ...tool, scopes: [{ kind: 'foreign' }] }, { ...tool, input_schema: { handler: () => 1 } },
      { ...tool, readiness: 'connecting' }]) expect(() => tools.register(bad as Tool)).toThrow();
    expect(tools.get('one')).toEqual(tool);
    const methods = new SkillCatalog();
    expect(() => methods.register({ ...skill, instructions: { kind: 'reader', reader_id: '', input_schema: {} } })).toThrow();
    expect(() => methods.register({ ...skill, instructions: { kind: 'inline', text: undefined } } as unknown as Skill)).toThrow();
    expect(methods.list()).toEqual([]);
  });
});
