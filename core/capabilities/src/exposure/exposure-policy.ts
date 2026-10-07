/** 能力 scope 规则的唯一领域 owner；扩展身份绑定和协议解析归接入层。 */
import { assertExecutionId, executionJson } from '../execution/invocation.js';

export type CapabilityScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'source_provider' | 'scene' | 'conversation'; readonly ids: [string, ...string[]] };

/** 只消费 scope 判断所需身份，不依赖 Conversation concrete 或平台 payload。 */
export interface CapabilityScopeContext {
  readonly source_provider_id: string;
  readonly scene_id: string;
  readonly conversation_id: string;
}

export const GLOBAL_CAPABILITY_SCOPE: CapabilityScope = Object.freeze({ kind: 'global' });

/** 三类定义共用可见性事实，不共用注册集合；scope 取交集而不是后者覆盖前者。 */
export interface CapabilityDefinition {
  readonly id: string;
  readonly owner_id: string;
  readonly revision: string;
  readonly name: string;
  readonly description: string;
  readonly audience: string;
  readonly readiness: 'ready' | 'contract_only' | 'degraded' | 'unavailable';
  readonly scopes: readonly CapabilityScope[];
}

export function isCapabilityDefinitionVisible(
  definition: CapabilityDefinition,
  context: CapabilityScopeContext | undefined,
): boolean {
  return definition.audience === 'character' && definition.readiness === 'ready'
    && definition.scopes.length > 0 && definition.scopes.every(scope => isCapabilityScopeVisible(scope, context));
}

/** 接入对象不能原地修改领域定义；此处只校验/冻结数据，不持有万能 Registry。 */
export function snapshotCapabilityDefinition<T extends CapabilityDefinition>(definition: T): T {
  const copy = JSON.parse(executionJson(definition)) as T;
  for (const id of [copy.id, copy.owner_id, copy.revision, copy.name, copy.audience]) assertExecutionId(id);
  if (typeof copy.description !== 'string'
    || !['ready', 'contract_only', 'degraded', 'unavailable'].includes(copy.readiness)
    || !Array.isArray(copy.scopes) || !copy.scopes.length) throw new Error('Capability definition 无效');
  for (const scope of copy.scopes) {
    if (!scope || !['global', 'source_provider', 'scene', 'conversation'].includes(scope.kind)
      || (scope.kind !== 'global' && (!Array.isArray(scope.ids) || !scope.ids.length
        || !scope.ids.every((id: unknown) => typeof id === 'string' && !!id.trim())))) throw new Error('Capability scope 无效');
  }
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(copy);
  return copy;
}

export function assertCapabilityOwner(definition: CapabilityDefinition | undefined, ownerId: string): void {
  assertExecutionId(ownerId);
  if (definition && definition.owner_id !== ownerId) throw new Error('Capability owner 冲突');
}

export function isCapabilityScopeVisible(
  scope: CapabilityScope | undefined,
  context: CapabilityScopeContext | undefined,
): boolean {
  const selected = scope === undefined ? GLOBAL_CAPABILITY_SCOPE : scope;
  if (!selected || typeof selected !== 'object') return false;
  if (selected.kind === 'global') return true;
  if (!context || !('ids' in selected) || !Array.isArray(selected.ids) || !selected.ids.length
    || !selected.ids.every(id => typeof id === 'string' && !!id.trim())) return false;
  // 未知 kind 不得落入 conversation 分支而意外授权。
  switch (selected.kind) {
    case 'source_provider': return selected.ids.includes(context.source_provider_id);
    case 'scene': return selected.ids.includes(context.scene_id);
    case 'conversation': return selected.ids.includes(context.conversation_id);
    default: return false;
  }
}
