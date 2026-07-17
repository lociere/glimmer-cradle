import type { SkillTool } from '../../../types';
import type { CorePlatformBridge } from '../core-platform-bridge';
import { createContractOnlyTool } from '../shared';

const clipboardReadParameters = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

const clipboardWriteParameters = {
  type: 'object',
  properties: {
    text: { type: 'string', description: '要写入剪贴板的文本。' },
  },
  required: ['text'],
  additionalProperties: false,
};

export function createClipboardTools(bridge: CorePlatformBridge): SkillTool[] {
  return [
    {
      name: 'clipboard.read',
      description: '读取系统剪贴板文本。该能力可能读取用户当前上下文，需要策略确认。',
      parameters: clipboardReadParameters,
      handler: () => bridge.readClipboardText(),
    },
    {
      name: 'clipboard.write',
      description: '写入系统剪贴板文本。该能力会改变用户系统状态，需要策略确认。',
      parameters: clipboardWriteParameters,
      handler: (args: unknown) => {
        const text = typeof (args as { text?: unknown })?.text === 'string'
          ? (args as { text: string }).text
          : '';
        return bridge.writeClipboardText(text);
      },
    },
  ];
}

export const clipboardTools = [
  createContractOnlyTool(
    'clipboard.read',
    '读取系统剪贴板文本。该能力可能读取用户当前上下文，需要策略确认。',
    'clipboard.read',
    clipboardReadParameters,
  ),
  createContractOnlyTool(
    'clipboard.write',
    '写入系统剪贴板文本。该能力会改变用户系统状态，需要策略确认。',
    'clipboard.write',
    clipboardWriteParameters,
  ),
];
