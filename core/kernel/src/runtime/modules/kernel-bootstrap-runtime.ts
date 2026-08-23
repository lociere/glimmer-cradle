import type { GlobalConfig } from '../../adapters/config/config-schema';
import { ConfigManager } from '../../adapters/config/config-manager';
import { DBManager } from '../../adapters/storage/db-manager';
import { initLogger } from '../../adapters/observability/logger';
import { startMetrics, stopMetrics } from '../../adapters/observability/metrics';
import { startTracer, stopTracer } from '../../adapters/observability/tracer';
import type { RuntimeModule } from './runtime-module';
import type { TraceContext } from '@glimmer-cradle/protocol';
import { EndpointRegistry } from '../../adapters/endpoints/endpoint-registry';
import { DeadLetterQueue } from '../../adapters/events/dead-letter-queue';

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
    this._config = ConfigManager.instance.getConfig();
    initLogger(this._config.system);

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
