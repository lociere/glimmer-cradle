import type { GlobalConfig } from '../../foundation/config/config-schema';
import { ConfigManager } from '../../foundation/config/config-manager';
import { DBManager } from '../../foundation/storage/db-manager';
import { initLogger } from '../../foundation/logger/logger';
import { startMetrics, stopMetrics } from '../../foundation/logger/metrics';
import { startTracer, stopTracer } from '../../foundation/logger/tracer';
import type { RuntimeModule } from './runtime-module';
import type { TraceContext } from '@glimmer-cradle/protocol';
import { EndpointRegistry } from '../../foundation/endpoints/endpoint-registry';

export class FoundationRuntime implements RuntimeModule {
  public readonly name = 'foundation';
  private _config: Readonly<GlobalConfig> | null = null;

  public get config(): Readonly<GlobalConfig> {
    if (!this._config) {
      throw new Error('FoundationRuntime 尚未启动，无法读取配置');
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
