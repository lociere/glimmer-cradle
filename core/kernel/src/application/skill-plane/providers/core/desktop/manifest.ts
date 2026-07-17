import type { SkillDescriptor } from '../../../types';
import type { CorePlatformBridge } from '../core-platform-bridge';
import { CORE_CONTRACT_METADATA, CORE_READY_METADATA, CORE_SKILL_PROVIDER, createPolicy } from '../shared';
import { createDesktopTools, desktopTools } from './tools';

export const desktopSkill: SkillDescriptor = {
  id: 'core.desktop',
  name: '桌面打开',
  description: 'Glimmer Cradle 内置的最小桌面打开能力，只承载 URL 与本地文件打开契约。',
  provider: CORE_SKILL_PROVIDER,
  tools: desktopTools,
  policy: createPolicy('medium', true, ['launch_external_app', 'open_url', 'open_file']),
  metadata: CORE_CONTRACT_METADATA,
};

export function createReadyDesktopSkill(bridge: CorePlatformBridge): SkillDescriptor {
  return {
    ...desktopSkill,
    tools: createDesktopTools(bridge),
    metadata: CORE_READY_METADATA,
  };
}
