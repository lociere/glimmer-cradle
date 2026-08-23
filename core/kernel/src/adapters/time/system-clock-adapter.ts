import type { KernelClockPort, ScheduledTaskPort } from '../../ports/clock.port';

class NodeScheduledTaskAdapter implements ScheduledTaskPort {
  private cancelled = false;

  public constructor(private readonly handle: ReturnType<typeof setTimeout>) {}

  public cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    clearTimeout(this.handle);
  }
}

export class SystemClockAdapter implements KernelClockPort {
  public nowMs(): number {
    return Date.now();
  }

  public monotonicNowMs(): number {
    return performance.now();
  }

  public schedule(delayMs: number, task: () => void): ScheduledTaskPort {
    return new NodeScheduledTaskAdapter(setTimeout(task, delayMs));
  }
}
