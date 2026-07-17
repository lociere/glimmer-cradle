import type { SkillDescriptor } from '../../../types';
import { CORE_CONTRACT_METADATA, CORE_SKILL_PROVIDER, createPolicy } from '../shared';
import { screenContextTools } from './tools';

export const screenContextSkill: SkillDescriptor = {
  id: 'core.screen_context',
  name: '屏幕上下文',
  description: 'Glimmer Cradle 内置的最小屏幕上下文能力，承载截图与活动窗口元信息契约。',
  provider: CORE_SKILL_PROVIDER,
  tools: screenContextTools,
  policy: createPolicy('high', true, ['read_screen', 'read_active_window']),
  metadata: CORE_CONTRACT_METADATA,
};
