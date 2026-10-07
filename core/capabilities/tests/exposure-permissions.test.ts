import { describe, expect, it } from 'vitest';
import { GLOBAL_CAPABILITY_SCOPE, isCapabilityScopeVisible, isCapabilityDefinitionVisible,
  ToolRegistry, ResourceRegistry, SkillCatalog, type CapabilityScope, type Tool, type Resource, type Skill } from '../src/index.js';

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

describe('Tool / Resource / Skill 独立 owner', () => {
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
