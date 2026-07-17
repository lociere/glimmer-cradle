import type { CapabilityScope, ConversationContext } from '@glimmer-cradle/protocol';

export const GLOBAL_CAPABILITY_SCOPE: CapabilityScope = { kind: 'global' };

export function resolveExtensionCapabilityScope(
  scope: CapabilityScope | undefined,
  extensionId: string,
  inherited: CapabilityScope = GLOBAL_CAPABILITY_SCOPE,
): CapabilityScope {
  const selected = scope ?? inherited;
  if (selected.kind === 'global') return selected;
  const [firstId, ...remainingIds] = selected.ids;
  return {
    ...selected,
    ids: [
      firstId === '$self' ? extensionId : firstId,
      ...remainingIds.map((id) => id === '$self' ? extensionId : id),
    ],
  };
}

export function isCapabilityScopeVisible(
  scope: CapabilityScope | undefined,
  conversation: ConversationContext | undefined,
): boolean {
  const selected = scope ?? GLOBAL_CAPABILITY_SCOPE;
  if (selected.kind === 'global') return true;
  if (!conversation) return false;

  if (selected.kind === 'source_provider') {
    return selected.ids.includes(conversation.source_provider_id);
  }
  if (selected.kind === 'scene') {
    return selected.ids.includes(conversation.scene_id);
  }
  return selected.ids.includes(conversation.conversation_id);
}
