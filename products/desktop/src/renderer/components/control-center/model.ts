import type { AudioProviderStatus, AudioStatus } from '../../store/appStore';

export type ControlCenterPage =
  | 'chat'
  | 'memory'
  | 'character'
  | 'capabilities'
  | 'logs'
  | 'settings';

export type DiagnosticLocationKey =
  | 'logs'
  | 'kernelLog'
  | 'kernelPrettyLog'
  | 'cognitionLog'
  | 'audioTtsLog'
  | 'audioAsrLog'
  | 'avatarHostLog'
  | 'avatarHostBuildLog'
  | 'avatarHostPackage'
  | 'avatarSdkPackage';

export type Tone = 'ready' | 'warn' | 'error' | 'neutral';

export interface PageItem {
  id: ControlCenterPage;
  label: string;
  eyebrow: string;
  description: string;
  icon: string;
}

export interface HealthSnapshot {
  summary: string;
  kernelLabel: string;
  kernelTone: Tone;
  ttsLabel: string;
  ttsTone: Tone;
  asrLabel: string;
  asrTone: Tone;
}

type RuntimeReadinessCatalog = Awaited<ReturnType<Window['desktopHost']['getRuntimeReadiness']>>;
type CharacterPresentationProjection = Awaited<ReturnType<Window['desktopHost']['getCharacterPresentationProjection']>>;

export interface ControlCenterSettingsDraft {
  inference: {
    maxTokens: number;
    temperature: number;
    topP: number;
  };
  lifeClock: {
    heartbeatEnabled: boolean;
    heartbeatIntervalMs: number;
    focusDurationMs: number;
    ingressDebounceMs: number;
    focusOnAnyChat: boolean;
    summonKeywords: string[];
  };
  embedding: {
    enabled: boolean;
    provider: string;
    cloudModel: string;
    dimensions: number;
    autoDownload: boolean;
    device: string;
    modelPath: string;
    modelId: string;
  };
  modelServices: {
    activeProviderId: string;
    providers: Array<{
      id: string;
      apiType: string;
      baseUrl: string;
      temperature: number;
      models: {
        chat: string;
        reasoner: string;
        vision: string;
        audio: string;
      };
    }>;
  };
  persona: {
    nickname: string;
    personaMode: string;
  };
  avatar: {
    enabled: boolean;
  };
  audio: {
    ttsEnabled: boolean;
    asrEnabled: boolean;
    cloudVoiceId: string;
  };
}

export type ControlCenterSettingsLoadState = 'loading' | 'ready' | 'error';
export type ControlCenterSettingsSaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface ControlCenterSettingsController {
  draft: ControlCenterSettingsDraft | null;
  savedDraft: ControlCenterSettingsDraft | null;
  loadState: ControlCenterSettingsLoadState;
  saveState: ControlCenterSettingsSaveState;
  message: string;
  isDirty: boolean;
  updateDraft: (updater: (current: ControlCenterSettingsDraft) => ControlCenterSettingsDraft) => void;
  resetDraft: (message?: string) => void;
  save: (fallbackMessage?: string) => Promise<void>;
}

export const PAGE_ITEMS: PageItem[] = [
  { id: 'chat', label: '对话', eyebrow: '对话', description: '与当前角色持续交流。', icon: '✦' },
  { id: 'memory', label: '记忆', eyebrow: '记忆', description: '回看经历、记忆与关系。', icon: '◇' },
  { id: 'character', label: '角色', eyebrow: '角色', description: '管理身份、声音与形象。', icon: '月' },
  { id: 'capabilities', label: '能力', eyebrow: '能力', description: '管理技能、扩展与连接。', icon: '▣' },
  { id: 'logs', label: '日志', eyebrow: '日志', description: '查看活动、模型与服务记录。', icon: '≡' },
  { id: 'settings', label: '设置', eyebrow: '设置', description: '管理工作台与服务偏好。', icon: '⚙' },
];

export const STATUS_LABELS: Record<string, string> = {
  online: '在线',
  connecting: '连接中',
  offline: '离线',
  error: '异常',
};

export const AVATAR_LABELS: Record<string, string> = {
  'unity-pending': '形象准备中',
  'unity': '形象已就绪',
};

export const PROVIDER_LABELS: Record<string, string> = {
  'dashscope-cosyvoice': 'CosyVoice 3.5 Flash',
  funasr: 'FunASR',
};

export const PROVIDER_STATUS_LABELS: Record<AudioProviderStatus['status'], string> = {
  ready: '就绪',
  degraded: '降级',
  unavailable: '不可用',
  circuit_open: '熔断',
  unknown: '未知',
};

export function pageById(id: ControlCenterPage): PageItem {
  return PAGE_ITEMS.find((page) => page.id === id) ?? PAGE_ITEMS[0];
}

function runtimeById(runtimeReadinessCatalog: RuntimeReadinessCatalog | null | undefined, runtimeId: string) {
  return runtimeReadinessCatalog?.runtimes.find((runtime) => runtime.runtime_id === runtimeId) ?? null;
}

function runtimeHealthSummary(runtimeReadinessCatalog: RuntimeReadinessCatalog | null | undefined): {
  summary: string | null;
  tone: Tone | null;
} {
  const runtimes = runtimeReadinessCatalog?.runtimes ?? [];
  if (runtimes.length === 0) return { summary: null, tone: null };
  if (runtimes.some((runtime) => runtime.blocking && runtime.state === 'failed')) {
    return { summary: '运行主线存在阻塞', tone: 'error' };
  }
  if (runtimes.some((runtime) => runtime.state === 'failed')) {
    return { summary: '运行主线存在异常', tone: 'error' };
  }
  if (runtimes.some((runtime) => runtime.blocking && (runtime.state === 'starting' || runtime.state === 'degraded' || runtime.state === 'stopped'))) {
    return { summary: '运行主线仍在准备', tone: 'warn' };
  }
  if (runtimes.some((runtime) => runtime.state === 'degraded')) {
    return { summary: '运行主线部分降级', tone: 'warn' };
  }
  return { summary: null, tone: null };
}

export function deriveAvatarReady(
  presentationProjection: CharacterPresentationProjection | null,
  runtimeReadinessCatalog: RuntimeReadinessCatalog | null,
): boolean {
  return Boolean(
    presentationProjection?.lifecycle.ready
    || runtimeById(runtimeReadinessCatalog, 'avatar.host')?.state === 'ready',
  );
}

export function deriveAvatarLabel(
  avatarRenderState: string,
  presentationProjection: CharacterPresentationProjection | null,
  runtimeReadinessCatalog: RuntimeReadinessCatalog | null,
): string {
  if (deriveAvatarReady(presentationProjection, runtimeReadinessCatalog)) {
    const readyHostKind = presentationProjection?.host_kind ?? 'unity';
    return AVATAR_LABELS[readyHostKind] ?? '形象已就绪';
  }
  return AVATAR_LABELS[avatarRenderState] ?? avatarRenderState;
}

export function deriveHealth(
  systemStatus: string,
  audioStatus: AudioStatus,
  runtimeReadinessCatalog?: RuntimeReadinessCatalog | null,
): HealthSnapshot {
  const ttsReady = audioStatus.tts.enabled && ['ready', 'degraded'].includes(audioStatus.tts.routeState);
  const asrReady = audioStatus.asr.enabled && audioStatus.asr.routeState === 'ready';
  const kernelReady = systemStatus === 'online';
  const runtimeHealth = runtimeHealthSummary(runtimeReadinessCatalog);
  const readyCount = [kernelReady, ttsReady, asrReady].filter(Boolean).length;
  const summary = runtimeHealth.summary ?? (readyCount === 3
    ? '核心能力已就绪'
    : kernelReady
      ? '核心在线，部分能力待准备'
      : '等待核心连接');
  const kernelTone = runtimeHealth.tone ?? (kernelReady ? 'ready' : 'warn');

  return {
    summary,
    kernelLabel: STATUS_LABELS[systemStatus] ?? systemStatus,
    kernelTone,
    ttsLabel: !audioStatus.tts.enabled ? '已关闭' : audioStatus.tts.routeState === 'degraded' ? '降级运行' : ttsReady ? '就绪' : audioStatus.tts.providers.length ? '需处理' : '等待',
    ttsTone: !audioStatus.tts.enabled ? 'neutral' : audioStatus.tts.routeState === 'degraded' ? 'warn' : ttsReady ? 'ready' : audioStatus.tts.providers.length ? 'error' : 'warn',
    asrLabel: !audioStatus.asr.enabled ? '已关闭' : asrReady ? '就绪' : audioStatus.asr.providers.length ? '需处理' : '等待',
    asrTone: !audioStatus.asr.enabled ? 'neutral' : asrReady ? 'ready' : audioStatus.asr.providers.length ? 'error' : 'warn',
  };
}

export function providerLabel(name: string): string {
  return PROVIDER_LABELS[name] ?? name;
}

export function audioInputStatusLabel(status: string): string {
  if (status === 'recording') return '录音中';
  if (status === 'recognizing') return '识别中';
  if (status === 'error') return '异常';
  return '空闲';
}

export function compactProviderMessage(message: string): string {
  if (message.includes('DASHSCOPE_API_KEY')) {
    return '尚未配置阿里百炼 API Key。';
  }
  if (message.includes('voice_id')) {
    return '当前角色尚未绑定 CosyVoice 声线 ID。';
  }
  if (message.length > 110) {
    return `${message.slice(0, 110)}...`;
  }
  return message;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
