import type { RuntimeModule } from './runtime-module';
import type { TraceContext } from '../../domain/kernel-contracts';
import type { ExtensionLifecycleControllerPort, ExtensionRuntimePort } from '../../ports/runtime-capabilities.port';

export class ExtensionRuntime implements RuntimeModule {
  public readonly name = 'extension-runtime';
  private extensionController: ExtensionLifecycleControllerPort | null = null;
  private _activationTask: Promise<void> | null = null;

  public constructor(
    private readonly extensionRuntime: ExtensionRuntimePort,
    private readonly productId: 'desktop' | 'personal-server',
  ) {}

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    const extensionManager = this.extensionRuntime.createController(this.productId);
    this.extensionController = extensionManager;
    await extensionManager.init();
    this.extensionRuntime.attachController(extensionManager);
    this._activationTask = extensionManager.startAllExtensions().catch(() => undefined);
    return {
      extension_host: 'discovering-complete',
      activation: 'background',
      runtime_readiness: extensionManager.getReadinessSnapshots(),
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    if (this.extensionController) {
      await this.extensionController.shutdown();
      this.extensionController = null;
    }
    this._activationTask = null;
    this.extensionRuntime.attachController(null);
  }
}
