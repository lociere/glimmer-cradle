import { CognitionManager } from '../../application/capabilities/inference/cognition-manager';
import type { RuntimeModule, RuntimeModuleStartDetails } from './runtime-module';
import type { TraceContext } from '@glimmer-cradle/protocol';

export class CognitionRuntime implements RuntimeModule {
  public readonly name = 'cognition';

  public async start(_context: TraceContext): Promise<RuntimeModuleStartDetails> {
    await CognitionManager.instance.start();
    return {
      readiness: 'ipc_config_knowledge_ready',
      runtime_readiness: {
        runtime_id: 'cognition',
        owner: 'cognition',
        phase: 'ipc_config_knowledge',
        state: 'ready',
        blocking: true,
        summary: 'Cognition 认知核已完成 IPC、配置与知识注入',
        details_ref: 'data/observability/logs/application/cognition.console.log',
      },
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    await CognitionManager.instance.stop();
  }
}
