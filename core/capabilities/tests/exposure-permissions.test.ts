import { describe, expect, it } from 'vitest';
import { GLOBAL_CAPABILITY_SCOPE, isCapabilityScopeVisible, type CapabilityScope } from '../src/index.js';

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
