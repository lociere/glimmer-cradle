import type { RuntimeModule } from './runtime-module';
import type { TraceContext } from '../../domain/kernel-contracts';
import type { KernelBootstrapPort } from '../../ports/kernel-lifecycle.port';
import type { KernelConfiguration } from '../../ports/configuration.port';

export class KernelBootstrapRuntime implements RuntimeModule {
  public readonly name = 'foundation';
  private _config: Readonly<KernelConfiguration> | null = null;

  public constructor(private readonly bootstrap: KernelBootstrapPort) {}

  public get config(): Readonly<KernelConfiguration> {
    if (!this._config) {
      throw new Error('KernelBootstrapRuntime 尚未启动，无法读取配置');
    }
    return this._config;
  }

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    const config = await this.bootstrap.start();
    this._config = config;
    return {
      config: 'ready',
      logger: 'ready',
      metrics: 'ready',
      tracer: 'ready',
      database: 'ready',
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    await this.bootstrap.stop();
    this._config = null;
  }
}
