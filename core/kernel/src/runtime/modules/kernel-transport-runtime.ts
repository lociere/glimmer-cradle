import type { GlobalConfig } from '../../ports/kernel-side-effects.port';
import { KernelCognitionTransport } from '../../ports/kernel-side-effects.port';
import { IngressGateManager } from '../../application/ingress/ingress-gate-manager';
import { RuntimeReadinessProjectionMapper } from '../../application/projection/runtime-readiness-projection';
import type { RuntimeReadinessSnapshot } from '../../ports/runtime-readiness.port';
import type { RuntimeModule } from './runtime-module';
import type { TraceContext } from '@glimmer-cradle/protocol';
import type { CognitionActionHandler } from '../../ports/cognition-service-port';

export class KernelTransportRuntime implements RuntimeModule {
  public readonly name = 'kernel-transport';

  public constructor(private readonly config: Readonly<GlobalConfig>) {}
  private recoveryEnabled = false;

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    IngressGateManager.instance.init(this.config.system.ingress);
    await KernelCognitionTransport.instance.start();
    return {
      cognition_control_transport: 'grpc_dynamic_loopback',
      ingress_gate: 'initialized',
      ingress_open: false,
      runtime_readiness: this.createIngressSnapshot('starting'),
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    this.closeIngress();
    await KernelCognitionTransport.instance.stop();
    IngressGateManager.instance.stop();
  }

  public openIngress(): void {
    this.recoveryEnabled = true;
    IngressGateManager.instance.setSystemReady(true);
    this.publishIngressSnapshot('ready');
  }

  public closeIngress(): void {
    this.recoveryEnabled = false;
    IngressGateManager.instance.setSystemReady(false);
    this.publishIngressSnapshot('stopped');
  }

  public suspendIngress(summary: string): void {
    IngressGateManager.instance.setSystemReady(false);
    RuntimeReadinessProjectionMapper.instance.replaceModuleSnapshots(this.name, [{
      ...this.createIngressSnapshot('stopped'),
      state: 'failed',
      summary,
    }]);
  }

  public restoreIngress(): void {
    if (this.recoveryEnabled) this.openIngress();
  }

  public setCognitionActionHandler(handler: CognitionActionHandler | null): void {
    KernelCognitionTransport.instance.setActionHandler(handler);
  }

  private publishIngressSnapshot(state: 'ready' | 'stopped'): void {
    RuntimeReadinessProjectionMapper.instance.replaceModuleSnapshots(
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
