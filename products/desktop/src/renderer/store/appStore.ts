import { create } from 'zustand';
import type { ChannelReplyMessage } from '@glimmer-cradle/protocol';
type CharacterPresentationProjection = Awaited<ReturnType<Window['desktopHost']['getCharacterPresentationProjection']>>;
type RuntimeReadinessCatalog = Awaited<ReturnType<Window['desktopHost']['getRuntimeReadiness']>>;

export interface ChatMessage {
  id: string;
  traceId?: string;
  sequence?: number;
  role: 'user' | 'assistant';
  content: string;
  contentType: ChannelReplyMessage['content_type'];
  language?: string | null;
  timestamp: number;
}

export interface ThoughtState {
  active: boolean;
  traceId?: string;
  hint?: string;
  updatedAt?: number;
}

export interface AudioProviderStatus {
  provider_id: string;
  role: 'primary' | 'fallback';
  execution: 'cloud' | 'local';
  status: 'ready' | 'degraded' | 'unavailable' | 'circuit_open' | 'unknown';
  message?: string;
}

export interface AudioCapabilityStatus {
  enabled: boolean;
  disabled_reason?: string;
  activeProvider?: string;
  routeState: 'disabled' | 'ready' | 'degraded' | 'unavailable' | 'unknown';
  providers: AudioProviderStatus[];
}

export interface AudioStatus {
  updatedAt?: number;
  tts: AudioCapabilityStatus;
  asr: AudioCapabilityStatus;
}

export interface AudioInputState {
  status: 'idle' | 'recording' | 'recognizing' | 'error';
  error?: string;
  startedAt?: number;
}

export interface AvatarAppearanceState {
  modelId: string;
  displayScale: number;
  placementId: string;
}

export type SystemStatus = 'connecting' | 'online' | 'offline' | 'error';
export type UIMode = 'float' | 'fullscreen';
export type AvatarRenderState = 'unity-pending' | 'unity';

interface AppState {
  messages: ChatMessage[];
  systemStatus: SystemStatus;
  uiMode: UIMode;
  avatarRenderState: AvatarRenderState;
  currentAvatarModel: string;
  avatarAppearance: AvatarAppearanceState;
  characterPresentationProjection: CharacterPresentationProjection | null;
  runtimeReadinessCatalog: RuntimeReadinessCatalog | null;
  thought: ThoughtState;
  audioStatus: AudioStatus;
  audioInput: AudioInputState;

  appendAssistantReply: (traceId: string, text: string, messages: ChannelReplyMessage[]) => void;
  addUserMessage: (content: string) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setThought: (thought: ThoughtState) => void;
  setAudioStatus: (status: AudioStatus) => void;
  setAudioInput: (state: AudioInputState) => void;
  clearChat: () => void;
  setSystemStatus: (status: SystemStatus) => void;
  setUIMode: (mode: UIMode) => void;
  setAvatarRenderState: (kind: AvatarRenderState) => void;
  setCurrentAvatarModel: (model: string) => void;
  setAvatarAppearance: (appearance: AvatarAppearanceState) => void;
  setCharacterPresentationProjection: (projection: CharacterPresentationProjection | null) => void;
  setRuntimeReadinessCatalog: (catalog: RuntimeReadinessCatalog | null) => void;
}

let messageIdCounter = 0;
const nextId = (): string => `msg_${Date.now()}_${++messageIdCounter}`;

export const useAppStore = create<AppState>((set) => ({
  messages: [],
  systemStatus: 'connecting',
  uiMode: 'float',
  avatarRenderState: 'unity-pending',
  currentAvatarModel: '',
  avatarAppearance: {
    modelId: '',
    displayScale: 1.2,
    placementId: '',
  },
  characterPresentationProjection: null,
  runtimeReadinessCatalog: null,
  thought: { active: false },
  audioStatus: {
    tts: { enabled: false, routeState: 'disabled', providers: [] },
    asr: { enabled: false, routeState: 'disabled', providers: [] },
  },
  audioInput: { status: 'idle' },

  appendAssistantReply: (traceId: string, text: string, messages: ChannelReplyMessage[]) => {
    const normalizedTraceId = traceId || undefined;
    const normalizedMessages = messages.length > 0
      ? messages
      : [{ sequence: 0, content_type: 'text' as const, text }];

    set((state) => {
      const nextMessages = normalizedMessages
        .filter((message) => message.text.trim().length > 0)
        .filter((message) => !(
          normalizedTraceId
          && state.messages.some((existing) => (
            existing.role === 'assistant'
            && existing.traceId === normalizedTraceId
            && existing.sequence === message.sequence
          ))
        ))
        .map((message) => ({
          id: nextId(),
          traceId: normalizedTraceId,
          sequence: message.sequence,
          role: 'assistant' as const,
          content: message.text,
          contentType: message.content_type,
          language: message.language,
          timestamp: Date.now(),
        }));

      if (nextMessages.length === 0) return state;

      return {
        messages: [
          ...state.messages,
          ...nextMessages,
        ],
      };
    });
  },

  addUserMessage: (content: string) => {
    set((state) => ({
      messages: [
        ...state.messages,
        { id: nextId(), role: 'user', content, contentType: 'text', timestamp: Date.now() },
      ],
    }));
  },

  setMessages: (messages: ChatMessage[]) => set({ messages }),

  setThought: (thought) => set({
    thought: {
      active: thought.active,
      traceId: thought.traceId,
      hint: thought.hint,
      updatedAt: thought.updatedAt ?? Date.now(),
    },
  }),

  setAudioStatus: (status) => set({ audioStatus: status }),

  setAudioInput: (audioInput) => set({ audioInput }),

  clearChat: () => set({ messages: [] }),

  setSystemStatus: (status) => set({ systemStatus: status }),

  setUIMode: (mode) => set({ uiMode: mode }),

  setAvatarRenderState: (kind) => set({ avatarRenderState: kind }),

  setCurrentAvatarModel: (model) => set({ currentAvatarModel: model }),

  setAvatarAppearance: (appearance) => set({
    avatarAppearance: appearance,
    currentAvatarModel: appearance.modelId,
  }),

  setCharacterPresentationProjection: (projection) => set((state) => ({
    characterPresentationProjection: projection,
    currentAvatarModel: projection?.model_id ?? state.currentAvatarModel,
  })),

  setRuntimeReadinessCatalog: (catalog) => set({ runtimeReadinessCatalog: catalog }),
}));
