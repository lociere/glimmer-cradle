import type { CorePlatformBridge, SkillTool, SkillRiskLevel } from '../../../../../ports/skill-plane.port';

export function createConfirmationTools(bridge: CorePlatformBridge): SkillTool[] {
  return [{
    name: 'confirmation.request',
    description: '展示标题与详情，取得用户本次答复；不会替代其他工具自己的权限确认。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 160, description: '确认标题。' },
        detail: { type: 'string', maxLength: 2000, description: '确认详情。' },
        riskLevel: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: '动作风险等级。',
        },
      },
      required: ['title', 'detail', 'riskLevel'],
      additionalProperties: false,
    },
    handler: async (args, context) => {
      const value = args as { title?: unknown; detail?: unknown; riskLevel?: unknown } | null;
      if (typeof value?.title !== 'string' || !value.title.trim() || value.title.length > 160
        || typeof value.detail !== 'string' || !value.detail.trim() || value.detail.length > 2000
        || !['low', 'medium', 'high', 'critical'].includes(String(value.riskLevel))) {
        throw new Error('confirmation.request 需要有效的标题、详情与风险等级');
      }
      context?.signal?.throwIfAborted();
      const approved = await bridge.requestConfirmation({
        traceId: context?.invocationId ?? '', skillId: 'core.confirmation', targetKind: 'tool', targetName: 'confirmation.request',
        title: value.title, detail: value.detail, riskLevel: value.riskLevel as SkillRiskLevel, sideEffects: ['request_confirmation'],
      });
      context?.signal?.throwIfAborted();
      return { ok: true, approved };
    },
  }];
}
