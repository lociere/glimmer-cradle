import { CognitionManager } from '../../application/capabilities/inference/cognition-manager';
import { CognitionClient } from '../../adapters/cognition/cognition-client';
import { KernelCognitionTransport } from '../../adapters/cognition/kernel-cognition-transport';
import { RuntimeReadinessProjectionMapper } from '../../application/projection/runtime-readiness-projection';
import type { CognitionLifecycleState } from '../../ports/cognition-service-port';
import type { KernelTransportRuntime } from './kernel-transport-runtime';
import type { RuntimeModule, RuntimeModuleStartDetails } from './runtime-module';
import type { TraceContext } from '@glimmer-cradle/protocol';

export class CognitionRuntime implements RuntimeModule {
  public readonly name = 'cognition';

  public constructor(private readonly transportRuntime: KernelTransportRuntime) {
    const transport = KernelCognitionTransport.instance;
    CognitionManager.configure(
      transport,
      new CognitionClient(transport),
      (state, summary) => this.publishLifecycle(state, summary),
    );
  }

  public async start(_context: TraceContext): Promise<RuntimeModuleStartDetails> {
    await CognitionManager.instance.start();
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
    await CognitionManager.instance.stop();
  }

  private publishLifecycle(state: CognitionLifecycleState, summary: string): void {
    RuntimeReadinessProjectionMapper.instance.replaceModuleSnapshots(this.name, [{
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
