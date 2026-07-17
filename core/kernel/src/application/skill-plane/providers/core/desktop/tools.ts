import type { SkillTool } from '../../../types';
import type { CorePlatformBridge } from '../core-platform-bridge';
import { createContractOnlyTool } from '../shared';

const openUrlParameters = {
  type: 'object',
  properties: {
    url: { type: 'string', description: '要打开的 URL。' },
  },
  required: ['url'],
  additionalProperties: false,
};

const openFileParameters = {
  type: 'object',
  properties: {
    path: { type: 'string', description: '本地文件或目录路径。' },
  },
  required: ['path'],
  additionalProperties: false,
};

export function createDesktopTools(bridge: CorePlatformBridge): SkillTool[] {
  return [
    {
      name: 'desktop.open_url',
      description: '打开一个 URL。只适合通用桌面打开动作，复杂浏览器自动化应交给 Extension 或 MCP Server。',
      parameters: openUrlParameters,
      handler: (args: unknown) => {
        const url = typeof (args as { url?: unknown })?.url === 'string'
          ? (args as { url: string }).url
          : '';
        if (!url.trim()) {
          throw new Error('desktop.open_url 需要 url');
        }
        return bridge.openUrl(url);
      },
    },
    createContractOnlyTool(
      'desktop.open_file',
      '打开本地文件或目录。涉及文件路径暴露与外部应用启动，必须经过策略确认。',
      'desktop.open_file',
      openFileParameters,
    ),
  ];
}

export const desktopTools = [
  createContractOnlyTool(
    'desktop.open_url',
    '打开一个 URL。只适合通用桌面打开动作，复杂浏览器自动化应交给 Extension 或 MCP Server。',
    'desktop.open_url',
    openUrlParameters,
  ),
  createContractOnlyTool(
    'desktop.open_file',
    '打开本地文件或目录。涉及文件路径暴露与外部应用启动，必须经过策略确认。',
    'desktop.open_file',
    openFileParameters,
  ),
];
