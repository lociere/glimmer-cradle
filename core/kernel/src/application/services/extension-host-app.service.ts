import type {
  DiagnosticsSnapshot,
  ExtensionCommandContribution,
  ExtensionManifest,
  ExtensionRuntimeProjection,
  ExtensionSkillContribution,
  PerceptionEvent,
} from '@glimmer-cradle/protocol';
import { randomUUID } from 'node:crypto';
import { SourceAttentionPolicy } from '../../domain/organism/life-clock/life-clock-manager';
import { DomainEvent } from '../../foundation/event-bus/events';
import {
  type ActiveExtensionSelection,
  type Disposable,
  type ExtensionAgentRegistration,
  type ExtensionAttentionLeaseRequest,
  type ExtensionCapabilityGraphReport,
  type ExtensionCommandHandler,
  type ExtensionCommandMetadata,
  type ExtensionEvidenceProposal,
  type ExtensionKeyValueStore,
  type ExtensionLogger,
  type ExtensionPerceptionProposal,
  IExtensionHostService,
  IExtensionSystemConfig,
} from '../../foundation/ports';
import { createTraceContext } from '../../foundation/logger/trace-context';
import { ConfigManager } from '../../foundation/config/config-manager';
import { EventBus } from '../../foundation/event-bus/event-bus';
import { getLogger } from '../../foundation/logger/logger';
import { ExtensionStorageRepository } from '../../foundation/storage/repositories/extension-storage-repository';
import { resolveRepoRoot } from '../../foundation/utils/path-utils';
import { AttentionLeaseStore } from '../../domain/attention/attention-lease-store';
import { LifeClockManager } from '../../domain/organism/life-clock/life-clock-manager';
import {
  createDeclaredExtensionSkill,
  createExtensionSkillFromSubAgent,
} from '../skill-plane/providers/extension/extension-skill-provider';
import { toExtensionProviderRuntimeSnapshot } from '../skill-plane/providers/extension/extension-provider-runtime';
import {
  DEFAULT_DESKTOP_SKILL_AVAILABILITY,
} from '../skill-plane/availability';
import type { SkillAvailabilityContext } from '../skill-plane/types';
import { PerceptionAppService } from './perception-app.service';
import { SkillCatalogAppService } from './skill-catalog-app.service';
import { ExtensionRuntimeRegistry } from './extension-runtime-registry';

export class ExtensionHostAppService implements IExtensionHostService {
  private readonly _commands = new Map<string, {
    extensionId: string;
    handler: ExtensionCommandHandler;
    metadata?: ExtensionCommandMetadata;
  }>();
  private readonly _runtimeRegistry: ExtensionRuntimeRegistry;

  constructor(
    private readonly _perceptionService: PerceptionAppService,
    private readonly _skillCatalogService: SkillCatalogAppService = new SkillCatalogAppService(),
    private readonly _availabilityContext: SkillAvailabilityContext = DEFAULT_DESKTOP_SKILL_AVAILABILITY,
    runtimeRegistry?: ExtensionRuntimeRegistry,
  ) {
    this._runtimeRegistry = runtimeRegistry ?? new ExtensionRuntimeRegistry(_availabilityContext);
  }

  public getConfig(): IExtensionSystemConfig {
    const config = ConfigManager.instance.getConfig();
    return {
      identity: {
        app_version: config.system.identity.app_version,
      },
      extensions: {
        extension_root_dir: config.system.extensions.extension_root_dir,
        sandbox: {
          timeout_ms: config.system.extensions.sandbox.timeout_ms,
        },
      },
    };
  }

  public getRepoRoot(): string {
    return resolveRepoRoot();
  }

  public async loadActiveExtensions(): Promise<ActiveExtensionSelection[]> {
    return ConfigManager.instance.loadActiveExtensions();
  }

  public async saveActiveExtensions(selections: ActiveExtensionSelection[]): Promise<void> {
    await ConfigManager.instance.saveActiveExtensions(selections);
  }

  public createLogger(module: string): ExtensionLogger {
    return getLogger(module);
  }

  public createStorage(extensionId: string): ExtensionKeyValueStore {
    return new ExtensionStorageRepository(extensionId);
  }

  public async submitEvidenceProposal(
    extensionId: string,
    proposal: ExtensionEvidenceProposal,
  ): Promise<void> {
    const content = String(proposal.content || '').trim();
    if (!content) {
      throw new Error('evidenceProposal.submit 需要 content');
    }

    const traceId = `evidence-proposal-${extensionId}-${Date.now()}`;

    await this.injectPerceptionWithEffect(extensionId, {
      id: traceId,
      sensoryType: 'text',
      address: proposal.address,
      timestamp: Date.now(),
      familiarity: 0,
      address_mode: 'ambient',
      response_policy: 'observe_only',
      source_event_id: proposal.sourceEventId,
      schema_ref: proposal.schemaRef,
      retention_ceiling: 'memory_candidate',
      content: {
        text: content,
        modality: ['text'],
      },
    }, 'evidence_proposal');
  }

  public registerCommand(
    extensionId: string,
    commandId: string,
    handler: ExtensionCommandHandler,
    metadata?: ExtensionCommandMetadata,
  ): Disposable {
    if (!commandId.startsWith(`${extensionId}.`) && !commandId.startsWith(`${extensionId}:`)) {
      throw new Error(`扩展 ${extensionId} 注册命令必须带命名空间前缀，当前为 ${commandId}`);
    }

    if (this._commands.has(commandId)) {
      throw new Error(`命令已存在: ${commandId}`);
    }

    this._commands.set(commandId, { extensionId, handler, metadata });

    return {
      dispose: () => {
        const current = this._commands.get(commandId);
        if (current?.extensionId === extensionId) {
          this._commands.delete(commandId);
        }
      },
    };
  }

  public async executeCommand(commandId: string, ...args: unknown[]): Promise<unknown> {
    const command = this._commands.get(commandId);
    if (!command) {
      throw new Error(`命令不存在: ${commandId}`);
    }

    return command.handler(...args);
  }

  public async listCommands(): Promise<ExtensionCommandContribution[]> {
    return Array.from(this._commands.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([commandId, entry]) => ({
        id: commandId,
        command: commandId,
        title: entry.metadata?.title ?? commandId,
        audience: 'user',
        scope: { kind: 'global' },
        requirements: { products: ['any'], platforms: ['any'], features: [] },
        category: entry.metadata?.category,
        permissions: [],
        dependsOn: [],
        metadata: {},
        actionKind: 'command',
        preconditions: [],
      }));
  }

  public subscribeEvent(eventName: string, handler: (event: unknown) => Promise<void>): Disposable {
    const wrappedHandler = async (event: DomainEvent) => {
      await handler(event);
    };

    EventBus.instance.subscribe(eventName, wrappedHandler);
    return {
      dispose: () => EventBus.instance.unsubscribe(eventName, wrappedHandler),
    };
  }

  public publishExtensionEvent(eventType: string, eventId: string, payload: unknown): void {
    void EventBus.instance.publish({
      event_type: eventType,
      event_id: eventId,
      trace_context: createTraceContext(),
      payload,
    } as never);
  }

  public publishDomainEvent(event: DomainEvent): void {
    void EventBus.instance.publish(event);
  }

  public async injectPerception(
    extensionId: string,
    proposal: ExtensionPerceptionProposal,
  ): Promise<void> {
    await this.injectPerceptionWithEffect(extensionId, proposal, 'observation');
  }

  private async injectPerceptionWithEffect(
    extensionId: string,
    proposal: ExtensionPerceptionProposal,
    cognitiveEffect: 'observation' | 'evidence_proposal',
  ): Promise<void> {
    if (proposal.address.provider_id !== extensionId) {
      throw new Error('ConversationAddress.provider_id 必须等于当前 extensionId');
    }
    const interactionId = proposal.id || randomUUID();
    const resolved = this._perceptionService.getConversationDirectory().resolve(
      proposal.address,
      interactionId,
    );
    const event: PerceptionEvent = {
      id: interactionId,
      trace_id: interactionId,
      sensoryType: proposal.sensoryType,
      source: resolved.source_key,
      timestamp: proposal.timestamp ?? Date.now(),
      familiarity: proposal.familiarity ?? 0,
      address_mode: proposal.address_mode ?? 'direct',
      response_policy: proposal.response_policy ?? 'reply_allowed',
      conversation: resolved.context,
      origin: {
        provider_kind: 'extension',
        provider_id: extensionId,
        contribution_id: proposal.contribution_id,
        source_event_id: proposal.source_event_id ?? interactionId,
        schema_ref: proposal.schema_ref ?? 'glimmer://extension/perception/v1',
        trust_tier: 'untrusted',
        privacy_class: proposal.address.visibility === 'public' ? 'public' : 'private',
        cognitive_effect: cognitiveEffect,
      },
      retention_ceiling: proposal.retention_ceiling ?? 'experience',
      content: {
        ...proposal.content,
        actor_id: resolved.actor_id,
        actor_name: resolved.actor_name,
      },
    };
    await this._perceptionService.processIngress(event);
  }

  public requestSceneAttentionLease(
    extensionId: string,
    request: ExtensionAttentionLeaseRequest,
  ): Disposable {
    const config = ConfigManager.instance.getConfig();
    const durationMs = request.durationMs ?? config.character.inference.life_clock.focus_duration_ms;
    AttentionLeaseStore.instance.acquire({
      scene_id: request.sceneId ?? request.channelId,
      channel_id: request.channelId,
      actor_id: request.actorId,
      owner: "extension",
      owner_id: extensionId,
      strength: request.strength ?? "focused",
      reason: request.reason ?? "active_dialogue",
      duration_ms: durationMs,
    });

    return {
      dispose: () => {
        AttentionLeaseStore.instance.release({
          owner: "extension",
          owner_id: extensionId,
          channel_id: request.channelId,
        });
      },
    };
  }

  public async isSceneFocused(channelId: string): Promise<boolean> {
    return AttentionLeaseStore.instance.isChannelFocused(channelId);
  }

  public registerSourcePolicies(_extensionId: string, policies: Record<string, string>): void {
    LifeClockManager.instance.registerSourcePolicies(policies as Record<string, SourceAttentionPolicy>);
  }

  public registerAgent(extensionId: string, profile: ExtensionAgentRegistration): Disposable {
    const skill = createExtensionSkillFromSubAgent(extensionId, profile, this._availabilityContext);
    if (!skill) {
      return { dispose: () => undefined };
    }
    this._skillCatalogService.registerSkill(skill);
    return {
      dispose: () => this._skillCatalogService.unregisterSkill(skill.id),
    };
  }

  public registerDeclaredSkills(
    extensionId: string,
    skills: ExtensionSkillContribution[],
  ): Disposable[] {
    return skills.map((contribution) => {
      const skill = createDeclaredExtensionSkill(extensionId, contribution, this._availabilityContext);
      if (!skill) {
        return { dispose: () => undefined };
      }
      this._skillCatalogService.registerSkill(skill);
      return {
        dispose: () => {
          const current = this._skillCatalogService.findCatalogEntry(skill.id);
          if (current?.metadata.implementation === 'extension-contribution') {
            this._skillCatalogService.unregisterSkill(skill.id);
          }
        },
      };
    });
  }

  public registerExtensionRuntimeManifest(manifest: Pick<
    ExtensionManifest,
    'id' | 'name' | 'version' | 'description' | 'permissions' | 'tags' | 'contributionPoints' | 'contributes'
  >): ExtensionRuntimeProjection {
    const projection = this._runtimeRegistry.registerManifest(manifest);
    this._skillCatalogService.upsertProviderRuntime(toExtensionProviderRuntimeSnapshot(projection));
    return projection;
  }

  public updateExtensionRuntimeLifecycle(
    extensionId: string,
    lifecycle: ExtensionRuntimeProjection['lifecycle'],
    summary?: string,
    error?: string,
  ): ExtensionRuntimeProjection | undefined {
    const projection = this._runtimeRegistry.updateLifecycle(extensionId, lifecycle, summary, error);
    if (projection) {
      this._skillCatalogService.upsertProviderRuntime(toExtensionProviderRuntimeSnapshot(projection));
    }
    return projection;
  }

  public mergeExtensionCapabilityGraph(
    extensionId: string,
    report: ExtensionCapabilityGraphReport,
  ): ExtensionRuntimeProjection | undefined {
    const projection = this._runtimeRegistry.mergeCapabilityGraph(extensionId, report);
    if (projection) {
      this._skillCatalogService.upsertProviderRuntime(toExtensionProviderRuntimeSnapshot(projection));
    }
    return projection;
  }

  public updateExtensionDiagnostics(
    extensionId: string,
    diagnostics: DiagnosticsSnapshot,
  ): ExtensionRuntimeProjection | undefined {
    const projection = this._runtimeRegistry.updateDiagnostics(extensionId, diagnostics);
    if (projection) {
      this._skillCatalogService.upsertProviderRuntime(toExtensionProviderRuntimeSnapshot(projection));
    }
    return projection;
  }

  public unregisterExtensionRuntime(extensionId: string): void {
    this._runtimeRegistry.unregister(extensionId);
    this._skillCatalogService.removeProviderRuntime({
      kind: 'extension',
      id: extensionId,
    });
  }

  public listExtensionRuntimeProjections(): ExtensionRuntimeProjection[] {
    return this._runtimeRegistry.list();
  }

  public getExtensionRuntimeProjection(extensionId: string): ExtensionRuntimeProjection | undefined {
    return this._runtimeRegistry.get(extensionId);
  }
}
