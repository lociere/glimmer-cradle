/** 能力 scope 规则的唯一领域 owner；扩展身份绑定和协议解析归接入层。 */
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
