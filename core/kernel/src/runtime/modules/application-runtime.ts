import type { SkillCatalogAppService } from '../../application/use-cases/skill-catalog-app.service';
import type { SkillPlanningAppService } from '../../application/use-cases/skill-planning-app.service';
import type { PerceptionAppService } from '../../application/use-cases/perception-app.service';
import type { IExtensionHostService } from '../../ports/extension-host.port';
import type { SkillProvider } from '../../ports/skill-plane.port';
import type { RuntimeReadinessSnapshot } from '../../ports/runtime-readiness.port';
import type { SkillActionController } from '../../application/skill-plane/skill-action-controller';
import type { CognitionActionHandler } from '../../ports/cognition-service-port';
import type { RuntimeModule } from './runtime-module';
import type { TraceContext } from '../../domain/kernel-contracts';
import type { KernelLoggerPort } from '../../ports/observability.port';

export class ApplicationRuntime implements RuntimeModule {
  public readonly name = 'application';
  private _skillCatalogAppService: SkillCatalogAppService | null = null;
  private _skillPlanningAppService: SkillPlanningAppService | null = null;
  private _perceptionAppService: PerceptionAppService | null = null;
  private _extensionHostAppService: IExtensionHostService | null = null;
  private readonly _skillProviders: SkillProvider[];

  public constructor(options: {
    readonly setCognitionActionHandler: (handler: CognitionActionHandler | null) => void;
    readonly logger: KernelLoggerPort;
    readonly skillProviders: SkillProvider[];
    readonly providerReadiness: () => RuntimeReadinessSnapshot[];
    readonly extensionHostService: IExtensionHostService;
    readonly skillCatalog: SkillCatalogAppService;
    readonly skillPlanning: SkillPlanningAppService;
    readonly skillAction: SkillActionController;
    readonly perception: PerceptionAppService;
  }) {
    this._skillProviders = options.skillProviders;
    this._setCognitionActionHandler = options.setCognitionActionHandler;
    this.logger = options.logger;
    this.providerReadiness = options.providerReadiness;
    this.extensionHostService = options.extensionHostService;
    this.skillCatalog = options.skillCatalog;
    this.skillPlanning = options.skillPlanning;
    this.skillAction = options.skillAction;
    this.perception = options.perception;
  }
  private readonly logger: KernelLoggerPort;
  private readonly providerReadiness: () => RuntimeReadinessSnapshot[];
  private readonly extensionHostService: IExtensionHostService;
  private readonly _setCognitionActionHandler: (handler: CognitionActionHandler | null) => void;
  private readonly skillCatalog: SkillCatalogAppService;
  private readonly skillPlanning: SkillPlanningAppService;
  private readonly skillAction: SkillActionController;
  private readonly perception: PerceptionAppService;

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

  public get extensionHostAppService(): IExtensionHostService {
    if (!this._extensionHostAppService) {
      throw new Error('ApplicationRuntime 尚未启动，无法读取 ExtensionHostAppService');
    }
    return this._extensionHostAppService;
  }

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    const skillCatalogAppService = this.skillCatalog;
    for (const provider of this._skillProviders) {
      await Promise.resolve(provider.start(skillCatalogAppService));
    }
    const skillPlanningAppService = this.skillPlanning;
    const skillActionController = this.skillAction;
    this._setCognitionActionHandler(
      (command, signal, operationId) => skillActionController.handleActionCommand(command, signal, operationId),
    );

    const perceptionAppService = this.perception;
    const extensionHostAppService = this.extensionHostService;

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
      runtime_readiness: this.providerReadiness(),
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    const skillCatalogAppService = this._skillCatalogAppService ?? this.skillCatalog;
    for (const provider of [...this._skillProviders].reverse()) {
      await Promise.resolve(provider.stop(skillCatalogAppService));
    }

    this._extensionHostAppService = null;
    this._perceptionAppService = null;
    this._skillPlanningAppService = null;
    this._skillCatalogAppService = null;
    this._setCognitionActionHandler(null);
    this.logger.debug('Application Runtime 已停止');
  }
}
