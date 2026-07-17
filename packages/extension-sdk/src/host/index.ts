import type { ConversationAddress, PerceptionEvent } from '@glimmer-cradle/protocol';
import type {
  ActionIntentSnapshot,
  CapabilityGraphEdge,
  CapabilityGraphNode,
  DiagnosticsSnapshot,
} from '@glimmer-cradle/protocol';
import type {
  CapabilityAudience,
  CapabilityScope,
  ContributionRequirements,
  ExtensionCommandContribution,
  ExtensionEventPayloadMap,
} from '@glimmer-cradle/protocol';

export type SensoryType =
  | 'VISUAL'
  | 'AUDITORY'
  | 'TEXT'
  | 'SYSTEM'
  | 'SOMATOSENSORY'
  | 'EMOTIONAL';

export interface Disposable {
  dispose(): void | Promise<void>;
}

export interface ExtensionLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface ExtensionKeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PerceptionPort {
  inject(proposal: ExtensionPerceptionProposal): void;
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

export type AttentionLeaseStrength = 'background' | 'watching' | 'focused' | 'pinned';
export type AttentionLeaseReason = 'direct_call' | 'wake_word' | 'active_dialogue' | 'manual_pin' | 'system';

export interface ExtensionAttentionLeaseRequest {
  sceneId?: string;
  channelId: string;
  actorId?: string;
  strength?: AttentionLeaseStrength;
  reason?: AttentionLeaseReason;
  durationMs?: number;
}

export interface SceneAttentionPort {
  requestAttentionLease(request: ExtensionAttentionLeaseRequest): Disposable;
  isSceneFocused(channelId: string): Promise<boolean>;
  registerSourcePolicies(policies: Record<string, string>): void;
}

export interface ExtensionEventBus {
  on<K extends keyof ExtensionEventPayloadMap>(
    eventName: K,
    handler: (payload: ExtensionEventPayloadMap[K]) => void,
  ): Disposable;
  on(eventName: string, handler: (payload: unknown) => void): Disposable;

  emit<K extends keyof ExtensionEventPayloadMap>(
    eventName: K,
    payload: ExtensionEventPayloadMap[K],
  ): void;
  emit(eventName: string, payload: unknown): void;
}

export interface MCPTool<TArgs = unknown> {
  name: string;
  description: string;
  audience?: CapabilityAudience;
  scope?: CapabilityScope;
  requirements?: ContributionRequirements;
  /** JSON Schema compatible parameter contract; functions and provider objects are not allowed. */
  parameters: unknown;
  handler: (args: TArgs) => Promise<unknown> | unknown;
}

export interface SubAgentProfile {
  id: string;
  name: string;
  description: string;
  audience?: CapabilityAudience;
  scope?: CapabilityScope;
  requirements?: ContributionRequirements;
  tools: MCPTool[];
  memoryImpact?: boolean;
  allowInterrupt?: boolean;
}

export interface AgentRegistryPort {
  registerSubAgent(profile: SubAgentProfile): Disposable;
}

export interface ExtensionCommandHandler {
  (...args: unknown[]): Promise<unknown> | unknown;
}

export interface ExtensionCommandMetadata {
  title?: string;
  category?: string;
}

export interface CommandRegistryPort {
  registerCommand(
    commandId: string,
    handler: ExtensionCommandHandler,
    metadata?: ExtensionCommandMetadata,
  ): Disposable;
  executeCommand(commandId: string, ...args: unknown[]): Promise<unknown>;
  listCommands(): Promise<ExtensionCommandContribution[]>;
}

export interface CapabilityGraphReport {
  nodes?: CapabilityGraphNode[];
  edges?: CapabilityGraphEdge[];
  actions?: ActionIntentSnapshot[];
  diagnostics?: DiagnosticsSnapshot;
}

export interface RuntimeProjectionPort {
  reportCapabilityGraph(report: CapabilityGraphReport): Promise<void>;
  reportDiagnostics(diagnostics: DiagnosticsSnapshot): Promise<void>;
}

export interface ExtensionEvidenceProposal {
  address: ConversationAddress;
  content: string;
  sourceEventId: string;
  schemaRef: string;
}

export interface EvidenceProposalPort {
  submit(proposal: ExtensionEvidenceProposal): Promise<void>;
}

export interface ExtensionHostPorts {
  readonly storage: ExtensionKeyValueStore;
  readonly evidenceProposal: EvidenceProposalPort;
  readonly perception: PerceptionPort;
  readonly sceneAttention: SceneAttentionPort;
  readonly events: ExtensionEventBus;
  readonly agents: AgentRegistryPort;
  readonly commands: CommandRegistryPort;
  readonly runtime: RuntimeProjectionPort;
}

export interface ExtensionContext<TConfig = unknown> {
  readonly extensionId: string;
  readonly logger: ExtensionLogger;
  readonly config: TConfig;
  readonly subscriptions: Disposable[];
  readonly ports: ExtensionHostPorts;
}

/**
 * Extension Host 调用的最小生命周期契约。
 *
 * 扩展作者通常不直接实现它，而是使用 `defineExtension()` 或继承 `BaseExtension`。
 */
export interface ExtensionModule<TConfig = unknown> {
  configSchema?: {
    safeParse(
      input: unknown,
    ):
      | { success: true; data: TConfig }
      | {
          success: false;
          error: {
            issues?: Array<{ path?: Array<string | number>; message: string }>;
          };
        };
  };
  onActivate(ctx: ExtensionContext<TConfig>): Promise<void> | void;
  onDeactivate?(): Promise<void> | void;
}

export type {
  ExtensionHostMessage,
  ExtensionHostMethod,
  ExtensionHostRequest,
  ExtensionRpcResponse,
  ExtensionWorkerMethod,
  ExtensionWorkerReady,
  ExtensionWorkerRequest,
} from './process-protocol';
