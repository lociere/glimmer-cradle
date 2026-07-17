import type { GlobalConfig } from '../../foundation/config/config-schema';
import { IPCServer } from '../../infrastructure/ipc-broker/ipc-server';
import { IngressGateManager } from '../../foundation/ingress-gate/ingress-gate-manager';
import { RuntimeReadinessCatalogStore } from '../../foundation/runtime-readiness-catalog';
import type { RuntimeReadinessSnapshot } from '../../foundation/runtime-readiness';
import type { RuntimeModule } from './runtime-module';
import type { TraceContext } from '@glimmer-cradle/protocol';

export class KernelTransportRuntime implements RuntimeModule {
  public readonly name = 'kernel-transport';

  public constructor(private readonly config: Readonly<GlobalConfig>) {}

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    IngressGateManager.instance.init(this.config.system.ingress);
    await IPCServer.instance.start();
    return {
      ipc_bind_address: IPCServer.instance.bindAddress,
      ingress_gate: 'initialized',
      ingress_open: false,
      runtime_readiness: this.createIngressSnapshot('starting'),
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    this.closeIngress();
    await IPCServer.instance.stop();
    IngressGateManager.instance.stop();
  }

  public openIngress(): void {
    IngressGateManager.instance.setSystemReady(true);
    this.publishIngressSnapshot('ready');
  }

  public closeIngress(): void {
    IngressGateManager.instance.setSystemReady(false);
    this.publishIngressSnapshot('stopped');
  }

  private publishIngressSnapshot(state: 'ready' | 'stopped'): void {
    RuntimeReadinessCatalogStore.instance.replaceModuleSnapshots(
      this.name,
      [this.createIngressSnapshot(state)],
    );
  }

  private createIngressSnapshot(state: 'starting' | 'ready' | 'stopped'): RuntimeReadinessSnapshot {
    return {
      runtime_id: 'kernel.ingress',
      owner: 'kernel',
      phase: 'ingress_gate',
      state,
      blocking: true,
      summary: state === 'ready'
        ? 'Kernel 输入主线已开放'
        : state === 'starting'
          ? 'Kernel 正在等待必需运行体就绪'
          : 'Kernel 输入主线已关闭',
    };
  }
}
