import { createContractOnlyTool } from '../shared';

export const screenContextTools = [
  createContractOnlyTool(
    'screen.capture',
    '请求当前屏幕截图。该能力涉及用户屏幕内容，必须经过策略确认。',
    'screen.capture',
    {
      type: 'object',
      properties: {
        displayId: { type: 'string', description: '可选显示器 ID。' },
      },
      additionalProperties: false,
    },
  ),
  createContractOnlyTool(
    'screen.active_window',
    '读取当前活动窗口的基础上下文。只返回窗口级元信息，不包含任意应用私有数据。',
    'screen.active_window',
    {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  ),
];
