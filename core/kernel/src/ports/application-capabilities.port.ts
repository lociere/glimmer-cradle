import type {
  ConfigurationSnapshot,
  ConfigurationTestRequest,
  ConfigurationTestResult,
  ConfigurationUpdateRequest,
  ConfigurationUpdateResult,
  ConversationHistoryRequest,
  ConversationHistoryResult,
  ConversationNotice,
  ControlSurfaceGatewayConfig,
} from '@glimmer-cradle/protocol';
import type { StateSyncEvent } from '../domain/events';
import type {
  AttentionLease,
  AttentionLeaseChangeHandler,
  AttentionLeaseReleaseRequest,
  AttentionLeaseRequest,
  AttentionProjection,
  AttentionProjectionMode,
} from '../domain/attention/attention-lease';
import type {
  ConversationAddress,
  PerceptionEvent,
} from './application-models';
import type { IAICapabilityPort, IActionStreamPort } from './ai-capability.port';
import type {
  SkillCatalogEntry,
  SkillCatalogSnapshot,
  SkillDescriptor,
  SkillProviderRef,
  SkillProviderRuntimeSnapshot,
} from './skill-plane.port';

export interface ConversationDirectoryPort {
  resolve(address: ConversationAddress, interactionId?: string): {
    readonly context: PerceptionEvent['conversation'];
    readonly actor_id?: string;
    readonly actor_name?: string;
    readonly source_key: string;
  };
}

export interface PerceptionApplicationPort {
  processIngress(event: PerceptionEvent): Promise<void>;
  getConversationDirectory(): ConversationDirectoryPort;
}

export interface SkillCatalogApplicationPort {
  registerSkill(skill: SkillDescriptor): void;
  unregisterSkill(skillId: string): void;
  upsertProviderRuntime(runtime: SkillProviderRuntimeSnapshot): void;
  removeProviderRuntime(provider: SkillProviderRef): void;
  findCatalogEntry(skillId: string): SkillCatalogEntry | undefined;
  getCatalogSnapshot(): SkillCatalogSnapshot;
}

export interface ConfigurationApplicationPort {
  hasUsableModelRoute(): boolean;
  getSnapshot(): Promise<ConfigurationSnapshot>;
  previewUpdate(request: ConfigurationUpdateRequest): Promise<ConfigurationUpdateResult>;
  applyUpdate(request: ConfigurationUpdateRequest): Promise<ConfigurationUpdateResult>;
  testProvider(request: ConfigurationTestRequest): Promise<ConfigurationTestResult>;
}

export interface ConversationHistoryPort {
  recordSubmittedUserMessage(text: string, traceId: string): void;
  updateThought(traceId: string, active: boolean): void;
  recordReply(traceId: string, text: string): void;
  recordNotice(traceId: string, notice: ConversationNotice): void;
  readHistory(request: ConversationHistoryRequest): Promise<ConversationHistoryResult>;
}

export type SourceAttentionPolicy =
  | 'always_focused'
  | 'wake_word_focus'
  | 'wake_word_focus_with_timeout'
  | 'chat_or_wake_focus_with_timeout'
  | 'ignore';

export interface AttentionLeasePort {
  acquire(request: AttentionLeaseRequest): AttentionLease;
  release(request: AttentionLeaseReleaseRequest): boolean;
  getProjection(baseMode?: Extract<AttentionProjectionMode, 'idle' | 'passive'>): AttentionProjection;
  isChannelFocused(channelId: string): boolean;
  hasFocusedLease(): boolean;
  setChangeHandler(handler: AttentionLeaseChangeHandler | null): void;
  clear(): void;
}

export interface AttentionApplicationPort {
  init(cognition: IAICapabilityPort, actionStream: IActionStreamPort): void;
  stop(): Promise<void>;
}

export interface LifeClockApplicationPort {
  init(cognition: IAICapabilityPort): Promise<void>;
  getStateSyncHandler(): (event: StateSyncEvent) => Promise<void>;
  registerSourcePolicies(policies: Record<string, SourceAttentionPolicy>): void;
  start(): void;
  stop(): void;
}

export interface ActionStreamApplicationPort extends IActionStreamPort {
  init(): void;
  stop(): void;
}

export interface VisualCommandApplicationPort {
  init(): void;
  stop(): void;
}

export interface ControlSurfaceGatewayPort {
  init(
    perception: PerceptionApplicationPort,
    catalog: SkillCatalogApplicationPort,
    config: ControlSurfaceGatewayConfig,
    requestApplicationShutdown: (reason: string) => Promise<void>,
  ): Promise<void>;
  setConfigApplicationService(service: ConfigurationApplicationPort | null): void;
  setConversationHistoryService(service: ConversationHistoryPort | null): void;
  stop(): Promise<void>;
}
