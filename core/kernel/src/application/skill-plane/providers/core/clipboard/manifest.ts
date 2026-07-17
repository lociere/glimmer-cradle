import type { SkillDescriptor } from '../../../types';
import type { CorePlatformBridge } from '../core-platform-bridge';
import { CORE_CONTRACT_METADATA, CORE_READY_METADATA, CORE_SKILL_PROVIDER, createPolicy } from '../shared';
import { clipboardTools, createClipboardTools } from './tools';

export const clipboardSkill: SkillDescriptor = {
  id: 'core.clipboard',
  name: '剪贴板',
  description: 'Glimmer Cradle 内置的最小剪贴板能力，只处理纯文本读取与写入契约。',
  provider: CORE_SKILL_PROVIDER,
  tools: clipboardTools,
  policy: createPolicy('medium', true, ['read_clipboard', 'write_clipboard']),
  metadata: CORE_CONTRACT_METADATA,
};

export function createReadyClipboardSkill(bridge: CorePlatformBridge): SkillDescriptor {
  return {
    ...clipboardSkill,
    tools: createClipboardTools(bridge),
    metadata: CORE_READY_METADATA,
  };
}
