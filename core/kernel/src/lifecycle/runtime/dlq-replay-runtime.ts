import type { TraceContext } from '@glimmer-cradle/protocol';
import { DlqReplayIngress } from '../../foundation/event-bus/dlq-replay-ingress';
import type { RuntimeModule } from './runtime-module';

export class DlqReplayRuntime implements RuntimeModule {
  public readonly name = 'dlq-replay-ingress';
  private readonly ingress = new DlqReplayIngress();

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    await this.ingress.start();
    return {
      runtime_readiness: {
        runtime_id: 'kernel.dlq-replay-ingress',
        owner: 'kernel',
        phase: 'durable_ingress',
        state: 'ready',
        blocking: false,
        summary: 'Kernel DLQ replay durable ingress 已开始消费 owner 绑定 envelope',
        details_ref: 'data/state/kernel/dlq-replay-inbox',
      },
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    await this.ingress.stop();
  }
}
