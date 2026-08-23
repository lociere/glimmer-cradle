import { ConfigManager } from '../config/config-manager';
import { DeadLetterQueue } from '../events/dead-letter-queue';
import { EndpointRegistry } from '../endpoints/endpoint-registry';
import { initLogger } from '../observability/logger';
import { startMetrics, stopMetrics } from '../observability/metrics';
import { startTracer, stopTracer } from '../observability/tracer';
import { DBManager } from '../storage/db-manager';
import type { KernelBootstrapPort, KernelConfiguration } from '../../ports';

export class NodeKernelBootstrapAdapter implements KernelBootstrapPort {
  public async start(): Promise<Readonly<KernelConfiguration>> {
    await ConfigManager.instance.init();
    const config = ConfigManager.instance.getConfig();
    initLogger(config.system);
    startMetrics();
    startTracer();
    await DBManager.instance.init();
    DeadLetterQueue.instance.init();
    return config as unknown as Readonly<KernelConfiguration>;
  }

  public async stop(): Promise<void> {
    await EndpointRegistry.instance.close();
    await DBManager.instance.close();
    stopMetrics();
    stopTracer();
  }
}
