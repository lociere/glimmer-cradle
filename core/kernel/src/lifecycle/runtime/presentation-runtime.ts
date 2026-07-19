import type { GlobalConfig } from '../../foundation/config/config-schema';
import { ActionStreamManager } from '../../application/capabilities/action-stream/action-stream-manager';
import { VisualCommandDispatcher } from '../../application/capabilities/action-stream/visual-command-dispatcher';
import { ControlSurfaceGateway } from '../../application/capabilities/control-surface/control-surface-gateway';
import { ConversationHistoryService } from '../../application/capabilities/control-surface/conversation-history-service';
import { CognitionManager } from '../../application/capabilities/inference/cognition-manager';
import { PerceptionAppService } from '../../application/services/perception-app.service';
import { ConfigApplicationService } from '../../application/services/config-application.service';
import { SkillCatalogAppService } from '../../application/services/skill-catalog-app.service';
import { ConfigManager } from '../../foundation/config/config-manager';
import type { RuntimeModule } from './runtime-module';
import type { TraceContext } from '@glimmer-cradle/protocol';

/** Lifecycle module for presentation routing and user-facing surfaces. */
export class PresentationRuntime implements RuntimeModule {
  public readonly name = 'presentation-runtime';

  public constructor(
    private readonly config: Readonly<GlobalConfig>,
    private readonly perceptionAppService: PerceptionAppService,
    private readonly skillCatalogAppService: SkillCatalogAppService,
    private readonly requestApplicationShutdown: (reason: string) => Promise<void>,
  ) {}

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    ActionStreamManager.instance.init();
    VisualCommandDispatcher.instance.init();

    if (this.config.system.surfaces.control_surface_gateway.enabled) {
      await ControlSurfaceGateway.instance.init(
        this.perceptionAppService,
        this.skillCatalogAppService,
        this.config.system.surfaces.control_surface_gateway,
        this.requestApplicationShutdown,
      );
      ControlSurfaceGateway.instance.setConfigApplicationService(new ConfigApplicationService({
        configManager: ConfigManager.instance,
        cognition: CognitionManager.instance,
      }));
      ControlSurfaceGateway.instance.setConversationHistoryService(
        new ConversationHistoryService(this.perceptionAppService.getConversationDirectory()),
      );
    }

    return {
      action_stream: 'ready',
      visual_dispatcher: 'ready',
      control_surface_gateway: this.config.system.surfaces.control_surface_gateway.enabled ? 'enabled' : 'disabled',
      control_surface_endpoint: 'dynamic-loopback',
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    ControlSurfaceGateway.instance.setConfigApplicationService(null);
    ControlSurfaceGateway.instance.setConversationHistoryService(null);
    await ControlSurfaceGateway.instance.stop();
    ActionStreamManager.instance.stop();
    VisualCommandDispatcher.instance.stop();
  }
}
