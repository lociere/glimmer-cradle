import type {
  DiagnosticsSnapshot,
  ExtensionCommandContribution,
  ExtensionEventPayloadMap,
} from '@glimmer-cradle/protocol';
import type {
  Disposable,
  ExtensionAgentRegistration,
  ExtensionAttentionLeaseRequest,
  ExtensionCapabilityGraphReport,
  ExtensionCommandHandler,
  ExtensionCommandMetadata,
  ExtensionEvidenceProposal,
  ExtensionKeyValueStore,
  ExtensionLogger,
  ExtensionPerceptionProposal,
} from '../../foundation/ports';

export interface ExtensionWorkerContext {
  readonly extensionId: string;
  readonly logger: ExtensionLogger;
  readonly config: Readonly<Record<string, unknown>>;
  readonly subscriptions: Disposable[];
  readonly ports: {
    readonly storage: ExtensionKeyValueStore;
    readonly evidenceProposal: {
      submit(proposal: ExtensionEvidenceProposal): Promise<void>;
    };
    readonly perception: {
      inject(proposal: ExtensionPerceptionProposal): void;
    };
    readonly sceneAttention: {
      requestAttentionLease(request: ExtensionAttentionLeaseRequest): Disposable;
      isSceneFocused(channelId: string): Promise<boolean>;
      registerSourcePolicies(policies: Record<string, string>): void;
    };
    readonly events: {
      on<K extends keyof ExtensionEventPayloadMap>(
        eventName: K,
        handler: (payload: ExtensionEventPayloadMap[K]) => void,
      ): Disposable;
      on(eventName: string, handler: (payload: unknown) => void): Disposable;
      emit<K extends keyof ExtensionEventPayloadMap>(eventName: K, payload: ExtensionEventPayloadMap[K]): void;
      emit(eventName: string, payload: unknown): void;
    };
    readonly agents: {
      registerSubAgent(profile: ExtensionAgentRegistration): Disposable;
    };
    readonly commands: {
      registerCommand(
        commandId: string,
        handler: ExtensionCommandHandler,
        metadata?: ExtensionCommandMetadata,
      ): Disposable;
      executeCommand(commandId: string, ...args: unknown[]): Promise<unknown>;
      listCommands(): Promise<ExtensionCommandContribution[]>;
    };
    readonly runtime: {
      reportCapabilityGraph(report: ExtensionCapabilityGraphReport): Promise<void>;
      reportDiagnostics(diagnostics: DiagnosticsSnapshot): Promise<void>;
    };
  };
}

export interface LoadedExtensionModule {
  configSchema?: {
    safeParse(input: unknown):
      | { success: true; data: unknown }
      | {
          success: false;
          error: { issues?: Array<{ path?: Array<string | number>; message: string }> };
        };
  };
  onActivate(context: ExtensionWorkerContext): Promise<void> | void;
  onDeactivate?(): Promise<void> | void;
}
