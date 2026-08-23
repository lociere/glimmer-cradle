import type { PresentationLifecyclePort } from '../../ports/runtime-capabilities.port';
import type { KernelConfiguration } from '../../ports/configuration.port';
import type {
  ActionStreamApplicationPort,
  ConfigurationApplicationPort,
  ControlSurfaceGatewayPort,
  ConversationHistoryPort,
  PerceptionApplicationPort,
  SkillCatalogApplicationPort,
  VisualCommandApplicationPort,
} from '../../ports/application-capabilities.port';

export class KernelPresentationAdapter implements PresentationLifecyclePort {
  public constructor(
    private readonly config: Readonly<KernelConfiguration>,
    private readonly actionStream: ActionStreamApplicationPort,
    private readonly visualDispatcher: VisualCommandApplicationPort,
    private readonly surface: ControlSurfaceGatewayPort,
    private readonly perception: PerceptionApplicationPort,
    private readonly catalog: SkillCatalogApplicationPort,
    private readonly configurationApplication: ConfigurationApplicationPort,
    private readonly conversationHistory: ConversationHistoryPort,
    private readonly requestApplicationShutdown: (reason: string) => Promise<void>,
  ) {}

  public get controlSurfaceEnabled(): boolean {
    return this.config.system.surfaces.control_surface_gateway.enabled;
  }

  public async start(): Promise<void> {
    this.actionStream.init();
    this.visualDispatcher.init();
    if (!this.controlSurfaceEnabled) return;
    await this.surface.init(
      this.perception,
      this.catalog,
      this.config.system.surfaces.control_surface_gateway,
      this.requestApplicationShutdown,
    );
    this.surface.setConfigApplicationService(this.configurationApplication);
    this.surface.setConversationHistoryService(this.conversationHistory);
  }

  public async stop(): Promise<void> {
    this.surface.setConfigApplicationService(null);
    this.surface.setConversationHistoryService(null);
    await this.surface.stop();
    this.actionStream.stop();
    this.visualDispatcher.stop();
  }
}
