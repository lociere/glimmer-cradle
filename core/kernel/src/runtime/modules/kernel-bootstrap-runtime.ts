import type { GlobalConfig } from '../../ports/kernel-side-effects.port';
import { ConfigManager } from '../../ports/kernel-side-effects.port';
import { DBManager } from '../../ports/kernel-side-effects.port';
import { initLogger } from '../../ports/kernel-side-effects.port';
import { startMetrics, stopMetrics } from '../../ports/kernel-side-effects.port';
import { startTracer, stopTracer } from '../../ports/kernel-side-effects.port';
import type { RuntimeModule } from './runtime-module';
import type { TraceContext } from '@glimmer-cradle/protocol';
import { EndpointRegistry } from '../../ports/kernel-side-effects.port';
import { DeadLetterQueue } from '../../ports/kernel-side-effects.port';

export class KernelBootstrapRuntime implements RuntimeModule {
  public readonly name = 'foundation';
  private _config: Readonly<GlobalConfig> | null = null;

  public get config(): Readonly<GlobalConfig> {
    if (!this._config) {
      throw new Error('KernelBootstrapRuntime 尚未启动，无法读取配置');
    }
    return this._config;
  }

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    await ConfigManager.instance.init();
    const config = ConfigManager.instance.getConfig() as Readonly<GlobalConfig>;
    this._config = config;
    initLogger(config.system);

    startMetrics();
    startTracer();

    await DBManager.instance.init();
    DeadLetterQueue.instance.init();
    return {
      config: 'ready',
      logger: 'ready',
      metrics: 'ready',
      tracer: 'ready',
      database: 'ready',
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    await EndpointRegistry.instance.close();
    await DBManager.instance.close();
    stopMetrics();
    stopTracer();
    this._config = null;
  }
}
