import type { KernelConfiguration } from '../../ports/configuration.port';
import type { KernelIngressPort, KernelTransportPort, RuntimeProjectionInputPort } from '../../ports/kernel-lifecycle.port';
import type { RuntimeReadinessSnapshot } from '../../ports/runtime-readiness.port';
import type { RuntimeModule } from './runtime-module';
import type { TraceContext } from '../../domain/kernel-contracts';
import type { CognitionActionHandler } from '../../ports/cognition-service-port';

export class KernelTransportRuntime implements RuntimeModule {
  public readonly name = 'kernel-transport';

  public constructor(
    private readonly config: Readonly<KernelConfiguration>,
    private readonly transport: KernelTransportPort<CognitionActionHandler>,
    private readonly ingress: KernelIngressPort,
    private readonly projection: RuntimeProjectionInputPort,
  ) {}
  private recoveryEnabled = false;

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    this.ingress.init(this.config.system.ingress);
    await this.transport.start();
    return {
      cognition_control_transport: 'grpc_dynamic_loopback',
      ingress_gate: 'initialized',
      ingress_open: false,
      runtime_readiness: this.createIngressSnapshot('starting'),
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    this.closeIngress();
    await this.transport.stop();
    this.ingress.stop();
  }

  public openIngress(): void {
    this.recoveryEnabled = true;
    this.ingress.setSystemReady(true);
    this.publishIngressSnapshot('ready');
  }

  public closeIngress(): void {
    this.recoveryEnabled = false;
    this.ingress.setSystemReady(false);
    this.publishIngressSnapshot('stopped');
  }

  public suspendIngress(summary: string): void {
    this.ingress.setSystemReady(false);
    this.projection.replaceModuleSnapshots(this.name, [{
      ...this.createIngressSnapshot('stopped'),
      state: 'failed',
      summary,
    }]);
  }

  public restoreIngress(): void {
    if (this.recoveryEnabled) this.openIngress();
  }

  public setCognitionActionHandler(handler: CognitionActionHandler | null): void {
    this.transport.setActionHandler(handler);
  }

  private publishIngressSnapshot(state: 'ready' | 'stopped'): void {
    this.projection.replaceModuleSnapshots(
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
