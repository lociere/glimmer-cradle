import type { SkillTool } from '../../../types';
import type { CorePlatformBridge } from '../core-platform-bridge';
import { createContractOnlyTool } from '../shared';

const notificationParameters = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '通知标题。' },
    body: { type: 'string', description: '通知正文。' },
  },
  required: ['title', 'body'],
  additionalProperties: false,
};

export function createNotificationTools(bridge: CorePlatformBridge): SkillTool[] {
  return [{
    name: 'notification.show',
    description: '显示一条系统通知。只适合短文本通知，复杂交互通知应由 Extension 提供。',
    parameters: notificationParameters,
    handler: (args: unknown) => {
      const value = args as { title?: unknown; body?: unknown };
      const title = typeof value?.title === 'string' ? value.title : '';
      const body = typeof value?.body === 'string' ? value.body : '';
      if (!title.trim() || !body.trim()) {
        throw new Error('notification.show 需要 title 与 body');
      }
      return bridge.showNotification(title, body);
    },
  }];
}

export const notificationTools = [
  createContractOnlyTool(
    'notification.show',
    '显示一条系统通知。只适合短文本通知，复杂交互通知应由 Extension 提供。',
    'notification.show',
    notificationParameters,
  ),
];
