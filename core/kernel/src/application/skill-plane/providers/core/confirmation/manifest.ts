import type { SkillDescriptor } from '../../../types';
import { CORE_CONTRACT_METADATA, CORE_SKILL_PROVIDER, createPolicy } from '../shared';
import { confirmationTools } from './tools';

export const confirmationSkill: SkillDescriptor = {
  id: 'core.confirmation',
  name: '用户确认',
  description: 'Glimmer Cradle 内置的确认请求契约，用于高风险技能执行前的统一确认。',
  provider: CORE_SKILL_PROVIDER,
  tools: confirmationTools,
  policy: createPolicy('low', false, ['request_confirmation']),
  metadata: CORE_CONTRACT_METADATA,
};
