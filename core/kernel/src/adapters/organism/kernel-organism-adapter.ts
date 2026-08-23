import type { OrganismLifecyclePort } from '../../ports/runtime-capabilities.port';
import type { IAICapabilityPort } from '../../ports/ai-capability.port';
import type {
  ActionStreamApplicationPort,
  AttentionApplicationPort,
  LifeClockApplicationPort,
} from '../../ports/application-capabilities.port';
import type { KernelEventBusPort } from '../../ports/event-bus.port';
import { createLifeClockReplayAdapter } from './life-clock-replay-adapter';

export class KernelOrganismAdapter implements OrganismLifecyclePort {
  public constructor(
    private readonly attention: AttentionApplicationPort,
    private readonly lifeClock: LifeClockApplicationPort,
    private readonly cognition: IAICapabilityPort,
    private readonly actionStream: ActionStreamApplicationPort,
    private readonly eventBus: KernelEventBusPort,
  ) {}

  public async start(): Promise<void> {
    this.attention.init(this.cognition, this.actionStream);
    await this.lifeClock.init(this.cognition);
    const handler = this.lifeClock.getStateSyncHandler();
    this.eventBus.subscribe('StateSyncEvent', handler, createLifeClockReplayAdapter(handler));
    this.lifeClock.start();
  }

  public async stop(): Promise<void> {
    this.lifeClock.stop();
    await this.attention.stop();
  }
}
