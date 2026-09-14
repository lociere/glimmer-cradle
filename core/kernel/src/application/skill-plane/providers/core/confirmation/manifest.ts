import type { CorePlatformBridge, SkillDescriptor } from '../../../../../ports/skill-plane.port';
import { CORE_SKILL_PROVIDER, createPolicy } from '../shared';
import { createConfirmationTools } from './tools';

export function createReadyConfirmationSkill(bridge: CorePlatformBridge): SkillDescriptor { return {
  id: 'core.confirmation',
  name: '用户确认',
  description: 'Glimmer Cradle 内置的确认请求契约，用于高风险技能执行前的统一确认。',
  provider: CORE_SKILL_PROVIDER,
  tools: createConfirmationTools(bridge),
  policy: createPolicy('low', false, ['request_confirmation']),
  metadata: { runtime_status: 'ready', implementation: 'control_surface_bridge' },
}; }
