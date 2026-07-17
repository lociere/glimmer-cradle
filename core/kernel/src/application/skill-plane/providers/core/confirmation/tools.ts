import { createContractOnlyTool } from '../shared';

export const confirmationTools = [
  createContractOnlyTool(
    'confirmation.request',
    '请求用户确认一个即将执行的技能动作。确认 UI 与审计链路由 Kernel 统一承载。',
    'confirmation.request',
    {
      type: 'object',
      properties: {
        title: { type: 'string', description: '确认标题。' },
        detail: { type: 'string', description: '确认详情。' },
        riskLevel: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: '动作风险等级。',
        },
      },
      required: ['title', 'detail', 'riskLevel'],
      additionalProperties: false,
    },
  ),
];
