import { getLogger } from '../../foundation/logger/logger';
import { SkillCatalogAppService } from '../../application/services/skill-catalog-app.service';
import { SkillPlanningAppService } from '../../application/services/skill-planning-app.service';
import { PerceptionAppService } from '../../application/services/perception-app.service';
import { ExtensionHostAppService } from '../../application/services/extension-host-app.service';
import { ConversationDirectory } from '../../application/capabilities/conversation/conversation-directory';
import { AudioService } from '../../application/capabilities/audio/audio-service';
import { ChannelStateStore } from '../../application/channel/channel-state-store';
import { AttentionSessionManager } from '../../domain/attention/attention-session-manager';
import { createSkillProviders } from '../../application/skill-plane/providers';
import type { SkillProvider } from '../../application/skill-plane/types';
import type { SkillAvailabilityContext } from '../../application/skill-plane/types';
import { McpServerSkillProvider } from '../../application/skill-plane/providers/mcp-server';
import { SkillActionController } from '../../application/skill-plane/skill-action-controller';
import { IPCServer } from '../../infrastructure/ipc-broker/ipc-server';
import { IPCMessageType } from '@glimmer-cradle/protocol';
import type { RuntimeModule } from './runtime-module';
import type { TraceContext } from '@glimmer-cradle/protocol';

const logger = getLogger('application-runtime');

export class ApplicationRuntime implements RuntimeModule {
  public readonly name = 'application';
  private _skillCatalogAppService: SkillCatalogAppService | null = null;
  private _skillPlanningAppService: SkillPlanningAppService | null = null;
  private _perceptionAppService: PerceptionAppService | null = null;
  private _extensionHostAppService: ExtensionHostAppService | null = null;
  private readonly _skillProviders: SkillProvider[];

  public constructor(options: {
    readonly localDeviceActions: boolean;
    readonly skillAvailability: SkillAvailabilityContext;
  }) {
    this._skillProviders = createSkillProviders(options);
    this._skillAvailability = options.skillAvailability;
  }
  private readonly _skillAvailability: SkillAvailabilityContext;

  public get skillCatalogAppService(): SkillCatalogAppService {
    if (!this._skillCatalogAppService) {
      throw new Error('ApplicationRuntime 尚未启动，无法读取 SkillCatalogAppService');
    }
    return this._skillCatalogAppService;
  }

  public get skillPlanningAppService(): SkillPlanningAppService {
    if (!this._skillPlanningAppService) {
      throw new Error('ApplicationRuntime 尚未启动，无法读取 SkillPlanningAppService');
    }
    return this._skillPlanningAppService;
  }

  public get perceptionAppService(): PerceptionAppService {
    if (!this._perceptionAppService) {
      throw new Error('ApplicationRuntime 尚未启动，无法读取 PerceptionAppService');
    }
    return this._perceptionAppService;
  }

  public get extensionHostAppService(): ExtensionHostAppService {
    if (!this._extensionHostAppService) {
      throw new Error('ApplicationRuntime 尚未启动，无法读取 ExtensionHostAppService');
    }
    return this._extensionHostAppService;
  }

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    const skillCatalogAppService = new SkillCatalogAppService();
    for (const provider of this._skillProviders) {
      await Promise.resolve(provider.start(skillCatalogAppService));
    }
    const skillPlanningAppService = new SkillPlanningAppService(skillCatalogAppService);
    const skillActionController = new SkillActionController(skillPlanningAppService);
    IPCServer.instance.registerHandler(
      IPCMessageType.ACTION_COMMAND,
      (request) => skillActionController.handleActionCommand(request),
    );

    const perceptionAppService = new PerceptionAppService(
      ConversationDirectory.instance,
      AudioService.instance,
      ChannelStateStore.instance,
      AttentionSessionManager.instance,
    );
    const extensionHostAppService = new ExtensionHostAppService(
      perceptionAppService,
      skillCatalogAppService,
      this._skillAvailability,
    );

    this._skillCatalogAppService = skillCatalogAppService;
    this._skillPlanningAppService = skillPlanningAppService;
    this._perceptionAppService = perceptionAppService;
    this._extensionHostAppService = extensionHostAppService;

    return {
      skill_provider_count: this._skillProviders.length,
      skill_count: this._skillProviders.reduce(
        (total, provider) => total + provider.listSkills().length,
        0,
      ),
      runtime_readiness: McpServerSkillProvider.instance.getReadinessSnapshots(),
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    const skillCatalogAppService = this._skillCatalogAppService ?? new SkillCatalogAppService();
    for (const provider of [...this._skillProviders].reverse()) {
      await Promise.resolve(provider.stop(skillCatalogAppService));
    }

    this._extensionHostAppService = null;
    this._perceptionAppService = null;
    this._skillPlanningAppService = null;
    this._skillCatalogAppService = null;
    logger.debug('Application Runtime 已停止');
  }
}
