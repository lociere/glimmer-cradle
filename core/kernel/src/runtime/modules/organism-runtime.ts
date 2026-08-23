import { ActionStreamManager } from '../../application/capabilities/action-stream/action-stream-manager';
import { AIProxy } from '../../application/capabilities/inference/ai-proxy';
import { AttentionSessionManager } from '../../application/attention/attention-session-manager';
import { LifeClockManager } from '../../application/organism/life-clock/life-clock-manager';
import type { RuntimeModule } from './runtime-module';
import type { TraceContext } from '@glimmer-cradle/protocol';
import { EventBus } from '../../ports/kernel-side-effects.port';
import { createLifeClockReplayAdapter } from '../../ports/kernel-side-effects.port';

export class OrganismRuntime implements RuntimeModule {
  public readonly name = 'organism-runtime';

  public async start(_context: TraceContext): Promise<Record<string, unknown>> {
    AttentionSessionManager.instance.init(AIProxy.instance, ActionStreamManager.instance);
    await LifeClockManager.instance.init(AIProxy.instance);
    EventBus.instance.subscribe('StateSyncEvent', LifeClockManager.instance.getStateSyncHandler(), createLifeClockReplayAdapter(LifeClockManager.instance.getStateSyncHandler()));
    LifeClockManager.instance.start();
    return {
      attention: 'ready',
      life_clock: 'started',
    };
  }

  public async stop(_context: TraceContext): Promise<void> {
    LifeClockManager.instance.stop();
    await AttentionSessionManager.instance.stop();
  }
}
