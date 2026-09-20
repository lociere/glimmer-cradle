import type {
  ExtensionCommandContribution,
  ExtensionManifest,
  ExtensionSkillContribution,
} from '@glimmer-cradle/extension-sdk';
import type { PerceptionEvent } from '../../ports/application-models';
import type { DiagnosticsSnapshot, ExtensionRuntimeProjection } from '../../ports/extension-runtime-projection';
import { randomUUID } from 'node:crypto';
import { DomainEvent } from '../../domain/events';
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
} from '../../ports';
import { createTraceContext } from '../observability/trace-context';
import { ConfigManager } from '../config/config-manager';
import { EventBus } from '../events/event-bus';
import { getLogger } from '../observability/logger';
import { ExtensionStorageRepository } from '../storage/repositories/extension-storage-repository';
import { resolveRepoRoot } from '../filesystem/path-utils';
import type {
  AttentionLeasePort,
  LifeClockApplicationPort,
  PerceptionApplicationPort,
  SkillCatalogApplicationPort,
  SourceAttentionPolicy,
} from '../../ports/application-capabilities.port';
import {
  createDeclaredExtensionSkill,
  createExtensionSkillFromSubAgent,
} from '../skill-plane/extension/extension-skill-provider';
import { toExtensionProviderRuntimeSnapshot } from '../skill-plane/extension/extension-provider-runtime';
import type { SkillAvailabilityContext, SkillPlanePolicyPort } from '../../ports/skill-plane.port';
import { ExtensionRuntimeRegistry } from './extension-runtime-registry';
import type { ContentPart } from '@glimmer-cradle/content';
import { StagedAssetUploads } from '../content/staged-asset-uploads';

export class ExtensionHostAppService implements IExtensionHostService {
  private readonly _commands = new Map<string, {
    extensionId: string;
    handler: ExtensionCommandHandler;
    metadata?: ExtensionCommandMetadata;
  }>();
  private readonly _runtimeRegistry: ExtensionRuntimeRegistry;

  constructor(
    private readonly _perceptionService: PerceptionApplicationPort,
    private readonly _skillCatalogService: SkillCatalogApplicationPort,
    private readonly _availabilityContext: SkillAvailabilityContext,
    private readonly skillPolicy: SkillPlanePolicyPort,
    private readonly attentionLeases: AttentionLeasePort,
    private readonly lifeClock: LifeClockApplicationPort,
    runtimeRegistry: ExtensionRuntimeRegistry,
    private readonly applicationVersion: string,
    private readonly uploads?: StagedAssetUploads,
  ) {
    this._runtimeRegistry = runtimeRegistry;
  }

  public getApplicationVersion(): string {
    return this.applicationVersion;
  }

  public getConfig(): IExtensionSystemConfig {
    const config = ConfigManager.instance.getConfig();
    return {
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
        requirements: { products: ['any'], platforms: ['any'], features: [], profiles: [] },
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

  public beginAssetUpload(extensionId: string, input: { mediaType: string; sizeBytes: number; sha256: string }): Promise<string> {
    if (!this.uploads) throw new Error('资产上传不可用');
    return this.uploads.begin(extensionId, input.mediaType, input.sizeBytes, input.sha256);
  }

  public async writeAssetUpload(extensionId: string, token: string, chunk: Uint8Array): Promise<void> {
    if (!this.uploads) throw new Error('资产上传不可用');
    await this.uploads.write(extensionId, token, chunk);
  }

  public async abortAssetUpload(extensionId: string, token: string): Promise<void> {
    if (!this.uploads) throw new Error('资产上传不可用');
    await this.uploads.abort(extensionId, token);
  }

  private async injectPerceptionWithEffect(
    extensionId: string,
    proposal: ExtensionPerceptionProposal,
    cognitiveEffect: 'observation' | 'evidence_proposal',
  ): Promise<void> {
    const rawContent = proposal && typeof proposal.content === 'object' && proposal.content !== null
      ? proposal.content as Record<string, unknown>
      : undefined;
    const rawPartsValue = rawContent?.parts;
    const rawParts = Array.isArray(rawPartsValue) ? rawPartsValue : [];
    const uploadTokens = rawParts.flatMap((part) => (
      part && typeof part === 'object' && typeof (part as Record<string, unknown>).uploadToken === 'string'
        ? [(part as Record<string, unknown>).uploadToken as string]
        : []
    ));
    const discardUploadTokens = async (): Promise<void> => {
      if (!this.uploads) return;
      const outcomes = await Promise.allSettled(uploadTokens.map((token) => this.uploads!.discard(extensionId, token)));
      const failed = outcomes.filter((outcome) => outcome.status === 'rejected').length;
      if (failed > 0) getLogger('extension-content').warn('失败 proposal 的暂存资产清理不完整', { failed });
    };
    const validatedParts: NonNullable<ExtensionPerceptionProposal['content']['parts']> = [];
    try {
      if (!rawContent) throw new Error('感知 content 无效');
      if (rawPartsValue !== undefined && !Array.isArray(rawPartsValue)) throw new Error('ContentPart 列表无效');
      for (const rawPart of rawParts) {
        if (!rawPart || typeof rawPart !== 'object') throw new Error('ContentPart 结构无效');
        const part = rawPart as Record<string, unknown>;
        if (part.kind === 'text') {
          if (typeof part.text !== 'string') throw new Error('文本 ContentPart 无效');
        } else if (
          part.kind !== 'file' && part.kind !== 'image' && part.kind !== 'audio' && part.kind !== 'video'
        ) {
          throw new Error('ContentPart 类型无效');
        } else if (typeof part.uploadToken !== 'string') {
          throw new Error('媒体上传 token 无效');
        }
        validatedParts.push(rawPart as NonNullable<ExtensionPerceptionProposal['content']['parts']>[number]);
      }
    } catch (error) {
      await discardUploadTokens();
      throw error;
    }

    const interactionId = proposal.id || randomUUID();
    const parts: Array<NonNullable<PerceptionEvent['content']['parts']>[number]> = [];
    let resolved: ReturnType<ReturnType<PerceptionApplicationPort['getConversationDirectory']>['resolve']>;
    try {
      if (proposal.address.provider_id !== extensionId) {
        throw new Error('ConversationAddress.provider_id 必须等于当前 extensionId');
      }
      resolved = this._perceptionService.getConversationDirectory().resolve(
        proposal.address,
        interactionId,
      );
      for (const part of validatedParts) {
        let content: ContentPart;
        if (part.kind === 'text') {
          content = { kind: 'text', text: part.text };
        } else {
          if (!this.uploads) throw new Error('资产上传不可用');
          const asset = await this.uploads.consume(extensionId, part.uploadToken, proposal.retention_ceiling ?? 'experience', part.kind);
          content = part.kind === 'file' ? { kind: 'file', asset, name: part.name } : { kind: part.kind, asset };
        }
        parts.push({ content, semantic: part.semantic });
      }
    } catch (error) {
      await discardUploadTokens();
      const assets = parts.flatMap((part) => part.content.kind === 'text' ? [] : [part.content.asset]);
      if (proposal.retention_ceiling === 'transient' && this.uploads) {
        await Promise.allSettled(assets.map((asset) => this.uploads!.releaseTransient(asset)));
      } else if (assets.length) {
        getLogger('extension-content').warn('上传转换中断，已提交资产需核查', {
          assetIds: assets.map((asset) => asset.assetId), interactionId,
        });
      }
      throw error;
    }
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
        parts,
        actor_id: resolved.actor_id,
        actor_name: resolved.actor_name,
      },
    };
    try {
      await this._perceptionService.processIngress(event);
    } catch (error) {
      if (event.retention_ceiling !== 'transient') {
        const assetIds = parts.flatMap((part) => part.content.kind === 'text' ? [] : [part.content.asset.assetId]);
        if (assetIds.length) getLogger('extension-content').warn('已提交但未确认写入 Moment 的资产需核查', { assetIds, interactionId });
      }
      throw error;
    } finally {
      if (event.retention_ceiling === 'transient' && this.uploads) {
        await Promise.all(parts.flatMap((part) => part.content.kind === 'text' ? [] : [this.uploads!.releaseTransient(part.content.asset)]));
      }
    }
  }

  public requestSceneAttentionLease(
    extensionId: string,
    request: ExtensionAttentionLeaseRequest,
  ): Disposable {
    const config = ConfigManager.instance.getConfig();
    const durationMs = request.durationMs ?? config.character.inference.life_clock.focus_duration_ms;
    this.attentionLeases.acquire({
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
        this.attentionLeases.release({
          owner: "extension",
          owner_id: extensionId,
          channel_id: request.channelId,
        });
      },
    };
  }

  public async isSceneFocused(channelId: string): Promise<boolean> {
    return this.attentionLeases.isChannelFocused(channelId);
  }

  public registerSourcePolicies(_extensionId: string, policies: Record<string, string>): void {
    this.lifeClock.registerSourcePolicies(policies as Record<string, SourceAttentionPolicy>);
  }

  public registerAgent(extensionId: string, profile: ExtensionAgentRegistration): Disposable {
    const skill = createExtensionSkillFromSubAgent(extensionId, profile, this._availabilityContext, this.skillPolicy);
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
      const skill = createDeclaredExtensionSkill(extensionId, contribution, this._availabilityContext, this.skillPolicy);
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
