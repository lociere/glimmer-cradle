import type { SkillDescriptor } from '../../../types';
import type { CorePlatformBridge } from '../core-platform-bridge';
import { CORE_CONTRACT_METADATA, CORE_READY_METADATA, CORE_SKILL_PROVIDER, createPolicy } from '../shared';
import { createNotificationTools, notificationTools } from './tools';

export const notificationSkill: SkillDescriptor = {
  id: 'core.notification',
  name: '系统通知',
  description: 'Glimmer Cradle 内置的最小通知能力，用于显示普通系统通知。',
  provider: CORE_SKILL_PROVIDER,
  tools: notificationTools,
  policy: createPolicy('low', false, ['show_notification']),
  metadata: CORE_CONTRACT_METADATA,
};

export function createReadyNotificationSkill(bridge: CorePlatformBridge): SkillDescriptor {
  return {
    ...notificationSkill,
    tools: createNotificationTools(bridge),
    metadata: CORE_READY_METADATA,
  };
}
