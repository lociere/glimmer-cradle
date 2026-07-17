import {
  Activity,
  AudioLines,
  Blocks,
  Bot,
  Brain,
  Database,
  FileClock,
  Image,
  ListChecks,
  MessageCircle,
  Palette,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { ControlCenterPage } from '../model';

export interface PageSectionItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

export const PAGE_ICONS: Record<ControlCenterPage, LucideIcon> = {
  chat: MessageCircle,
  memory: Brain,
  character: UserRound,
  capabilities: Blocks,
  logs: FileClock,
  settings: Settings2,
};

export const PAGE_SECTIONS: Record<ControlCenterPage, PageSectionItem[]> = {
  chat: [
    { id: 'session', label: '当前对话', icon: MessageCircle },
    { id: 'context', label: '对话上下文', icon: Brain },
  ],
  memory: [
    { id: 'preview', label: '最近记录', icon: FileClock },
    { id: 'layers', label: '经历与记忆', icon: Blocks },
    { id: 'knowledge', label: '知识资料', icon: Database },
    { id: 'attention', label: '注意力', icon: Sparkles },
  ],
  character: [
    { id: 'profile', label: '角色资料', icon: UserRound },
    { id: 'persona', label: '人设基调', icon: Brain },
    { id: 'wake', label: '唤醒方式', icon: Sparkles },
    { id: 'voice', label: '声音', icon: AudioLines },
    { id: 'avatar-status', label: '形象状态', icon: Image },
    { id: 'avatar-model', label: '模型与动作', icon: Bot },
    { id: 'avatar-placement', label: '桌面位置', icon: SlidersHorizontal },
  ],
  capabilities: [
    { id: 'skills', label: '技能', icon: Sparkles },
    { id: 'extensions', label: '扩展', icon: Blocks },
    { id: 'voice-status', label: '语音服务', icon: AudioLines },
    { id: 'automation', label: '自动化', icon: Activity },
  ],
  logs: [
    { id: 'observability', label: '日志流', icon: TerminalSquare },
    { id: 'traces', label: '交互链路', icon: Activity },
    { id: 'runtime', label: '服务状态', icon: ListChecks },
    { id: 'logs', label: '文件与维护', icon: FileClock },
  ],
  settings: [
    { id: 'general', label: '通用', icon: Settings2 },
    { id: 'workbench', label: '外观', icon: Palette },
    { id: 'conversation', label: '对话', icon: MessageCircle },
    { id: 'model-services', label: '模型服务', icon: Database },
    { id: 'voice', label: '语音服务', icon: AudioLines },
    { id: 'character', label: '角色', icon: UserRound },
    { id: 'privacy', label: '隐私与权限', icon: ShieldCheck },
    { id: 'data', label: '数据', icon: Database },
    { id: 'advanced', label: '高级', icon: SlidersHorizontal },
  ],
};

export function defaultControlCenterSection(page: ControlCenterPage): string {
  return PAGE_SECTIONS[page][0]?.id ?? 'main';
}
