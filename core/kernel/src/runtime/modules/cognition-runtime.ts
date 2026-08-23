import type { CognitionLifecycleState } from '../../ports/cognition-service-port';
import type { CognitionLifecycleUseCasePort, RuntimeProjectionInputPort } from '../../ports/kernel-lifecycle.port';
import type { KernelTransportRuntime } from './kernel-transport-runtime';
import type { RuntimeModule, RuntimeModuleStartDetails } from './runtime-module';
import type { TraceContext } from '../../domain/kernel-contracts';

export class CognitionRuntime implements RuntimeModule {
  public readonly name = 'cognition';

  public constructor(
    private readonly transportRuntime: KernelTransportRuntime,
    private readonly cognition: CognitionLifecycleUseCasePort,
    private readonly projection: RuntimeProjectionInputPort,
  ) {}

  public async start(_context: TraceContext): Promise<RuntimeModuleStartDetails> {
    await this.cognition.start();
    return {
      readiness: 'service_config_knowledge_ready',
      runtime_readiness: {
        runtime_id: 'cognition',
        owner: 'cognition',
        phase: 'service_config_knowledge',
        state: 'ready',
        blocking: true,
        summary: 'Cognition 认知核已完成 Service 注册、配置与知识注入',
        details_ref: 'data/observability/logs/application/cognition.console.log',
      },
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    await this.cognition.stop();
  }

  public acceptLifecycleFact(state: CognitionLifecycleState, summary: string): void {
    this.projection.replaceModuleSnapshots(this.name, [{
      runtime_id: 'cognition',
      owner: 'cognition',
      phase: state === 'ready' ? 'service_config_knowledge' : 'supervised_process',
      state,
      blocking: true,
      summary,
      details_ref: 'data/observability/logs/application/cognition.console.log',
    }]);
    if (state === 'ready') this.transportRuntime.restoreIngress();
    else if (state === 'starting' || state === 'failed') this.transportRuntime.suspendIngress(summary);
  }
}
