import type { KernelConfiguration, KernelConfigurationPort } from '../../ports/configuration.port';
import { ConfigManager } from './config-manager';

export class KernelConfigurationAdapter implements KernelConfigurationPort {
  public async init(): Promise<void> {
    await ConfigManager.instance.init();
  }

  public getConfig(): Readonly<KernelConfiguration> {
    return ConfigManager.instance.getConfig() as unknown as Readonly<KernelConfiguration>;
  }

  public freezeCoreConfig(): void {
    ConfigManager.instance.freezeCoreConfig();
  }

  public loadDashScopeSecretEnvironment(): Promise<Readonly<Record<string, string>>> {
    return ConfigManager.instance.loadDashScopeSecretEnvironment();
  }
}
