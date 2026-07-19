import type {
  ActionIntentSnapshot,
  CapabilityAudience,
  CapabilityGraphEdge,
  CapabilityGraphNode,
  CapabilityScope,
  ContributionRequirements,
  ConversationAddress,
  DiagnosticsSnapshot,
  ExtensionCommandContribution,
  ExtensionManifest,
  ExtensionRuntimeProjection,
  ExtensionSkillContribution,
  PerceptionEvent,
} from '@glimmer-cradle/protocol';
import { DomainEvent } from '../event-bus/events/domain-events';

export interface Disposable {
  dispose(): void | Promise<void>;
}

export interface ExtensionLogger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export interface ExtensionKeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ExtensionPerceptionProposal {
  id?: string;
  sensoryType: string;
  address: ConversationAddress;
  timestamp?: number;
  familiarity?: number;
  address_mode?: PerceptionEvent['address_mode'];
  response_policy?: PerceptionEvent['response_policy'];
  retention_ceiling?: PerceptionEvent['retention_ceiling'];
  source_event_id?: string;
  schema_ref?: string;
  contribution_id?: string;
  content: Omit<PerceptionEvent['content'], 'actor_id' | 'actor_name'>;
}

export interface ExtensionEvidenceProposal {
  address: ConversationAddress;
  content: string;
  sourceEventId: string;
  schemaRef: string;
}

export interface ExtensionAttentionLeaseRequest {
  sceneId?: string;
  channelId: string;
  actorId?: string;
  strength?: 'background' | 'watching' | 'focused' | 'pinned';
  reason?: 'direct_call' | 'wake_word' | 'active_dialogue' | 'manual_pin' | 'system';
  durationMs?: number;
}

export interface ExtensionCommandMetadata {
  title?: string;
  category?: string;
}

export type ExtensionCommandHandler = (...args: unknown[]) => Promise<unknown> | unknown;

export interface ExtensionToolRegistration {
  name: string;
  description: string;
  audience?: CapabilityAudience;
  scope?: CapabilityScope;
  requirements?: ContributionRequirements;
  parameters: unknown;
  handler: (args: unknown) => Promise<unknown> | unknown;
}

export interface ExtensionAgentRegistration {
  id: string;
  name: string;
  description: string;
  audience?: CapabilityAudience;
  scope?: CapabilityScope;
  requirements?: ContributionRequirements;
  tools: ExtensionToolRegistration[];
  memoryImpact?: boolean;
  allowInterrupt?: boolean;
}

export interface ExtensionCapabilityGraphReport {
  nodes?: CapabilityGraphNode[];
  edges?: CapabilityGraphEdge[];
  actions?: ActionIntentSnapshot[];
  diagnostics?: DiagnosticsSnapshot;
}

export interface IExtensionSystemConfig {
  identity: {
    app_version: string;
  };
  extensions: {
    extension_root_dir: string;
    sandbox: {
      timeout_ms: number;
    };
  };
}

export interface ActiveExtensionSelection {
  id: string;
  version: string;
  profile: string;
}

export interface IExtensionHostService {
  getConfig(): IExtensionSystemConfig;
  getRepoRoot(): string;
  loadActiveExtensions(): Promise<ActiveExtensionSelection[]>;
  saveActiveExtensions(selections: ActiveExtensionSelection[]): Promise<void>;

  createLogger(module: string): ExtensionLogger;
  createStorage(extensionId: string): ExtensionKeyValueStore;
  submitEvidenceProposal(extensionId: string, proposal: ExtensionEvidenceProposal): Promise<void>;
  registerCommand(
    extensionId: string,
    commandId: string,
    handler: ExtensionCommandHandler,
    metadata?: ExtensionCommandMetadata,
  ): Disposable;
  executeCommand(commandId: string, ...args: unknown[]): Promise<unknown>;
  listCommands(): Promise<ExtensionCommandContribution[]>;

  subscribeEvent(eventName: string, handler: (event: unknown) => Promise<void>): Disposable;
  publishExtensionEvent(eventType: string, eventId: string, payload: unknown): void;
  publishDomainEvent(event: DomainEvent): void;

  injectPerception(extensionId: string, proposal: ExtensionPerceptionProposal): Promise<void>;

  requestSceneAttentionLease(extensionId: string, request: ExtensionAttentionLeaseRequest): Disposable;
  isSceneFocused(channelId: string): Promise<boolean>;
  registerSourcePolicies(extensionId: string, policies: Record<string, string>): void;

  registerAgent(extensionId: string, profile: ExtensionAgentRegistration): Disposable;
  registerDeclaredSkills(extensionId: string, skills: ExtensionSkillContribution[]): Disposable[];

  registerExtensionRuntimeManifest(manifest: Pick<
    ExtensionManifest,
    'id' | 'name' | 'version' | 'description' | 'permissions' | 'tags' | 'contributionPoints' | 'contributes'
  >): ExtensionRuntimeProjection;
  updateExtensionRuntimeLifecycle(
    extensionId: string,
    lifecycle: ExtensionRuntimeProjection['lifecycle'],
    summary?: string,
    error?: string,
  ): ExtensionRuntimeProjection | undefined;
  mergeExtensionCapabilityGraph(
    extensionId: string,
    report: ExtensionCapabilityGraphReport,
  ): ExtensionRuntimeProjection | undefined;
  updateExtensionDiagnostics(
    extensionId: string,
    diagnostics: DiagnosticsSnapshot,
  ): ExtensionRuntimeProjection | undefined;
  unregisterExtensionRuntime(extensionId: string): void;
  listExtensionRuntimeProjections(): ExtensionRuntimeProjection[];
  getExtensionRuntimeProjection(extensionId: string): ExtensionRuntimeProjection | undefined;
}
