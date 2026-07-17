import { ExtensionManager } from '../../host/extension-manager';
import { ExtensionHostAppService } from '../../application/services/extension-host-app.service';
import { ControlSurfaceGateway } from '../../application/capabilities/control-surface/control-surface-gateway';
import type { RuntimeModule } from './runtime-module';
import type { ExtensionProductTarget, TraceContext } from '@glimmer-cradle/protocol';

export class ExtensionRuntime implements RuntimeModule {
  public readonly name = 'extension-runtime';
  private _extensionManager: ExtensionManager | null = null;
  private _activationTask: Promise<void> | null = null;

  public constructor(
    private readonly extensionHostAppService: ExtensionHostAppService,
    private readonly productId: Exclude<ExtensionProductTarget, 'any'>,
  ) {}

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    const extensionManager = new ExtensionManager(this.extensionHostAppService, this.productId);
    this._extensionManager = extensionManager;
    await extensionManager.init();
    ControlSurfaceGateway.instance.setExtensionLifecycleController(extensionManager);
    this._activationTask = extensionManager.startAllExtensions().catch(() => undefined);
    return {
      extension_host: 'discovering-complete',
      activation: 'background',
      runtime_readiness: extensionManager.getReadinessSnapshots(),
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    if (this._extensionManager) {
      await this._extensionManager.shutdown();
      this._extensionManager = null;
    }
    this._activationTask = null;
    ControlSurfaceGateway.instance.setExtensionLifecycleController(null);
  }
}
