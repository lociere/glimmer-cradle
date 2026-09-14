import type { CorePlatformBridge, SkillTool } from '../../../../../ports/skill-plane.port';

export function createScreenContextTools(bridge: CorePlatformBridge): SkillTool[] { return [
  {
    name: 'screen.capture',
    description: '保存当前显示器截图并返回本地文件位置；不会自动识别图片内容，必须经过策略确认。',
    parameters: {
      type: 'object',
      properties: {
        displayId: { type: 'string', description: '可选显示器 ID。' },
      },
      additionalProperties: false,
    },
    handler: (args, context) => {
      const displayId = (args as { displayId?: unknown })?.displayId;
      if (displayId !== undefined && (typeof displayId !== 'string' || !displayId.trim())) throw new Error('displayId 必须是非空字符串');
      return bridge.captureScreen(displayId as string | undefined, context?.invocationId);
    },
  },
  {
    name: 'screen.active_window',
    description: '读取 Windows 当前前台窗口的标题和进程 ID，不读取应用内部数据。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    handler: (_args, context) => bridge.readActiveWindow(context?.invocationId),
  },
]; }
