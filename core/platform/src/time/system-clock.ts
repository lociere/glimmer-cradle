import type { Clock, ScheduledTask } from './clock.js';

class NodeScheduledTask implements ScheduledTask {
  private cancelled = false;

  public constructor(private readonly handle: ReturnType<typeof setTimeout>) {}

  public cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    clearTimeout(this.handle);
  }
}

export class SystemClock implements Clock {
  public nowMs(): number {
    return Date.now();
  }

  public monotonicNowMs(): number {
    return performance.now();
  }

  public schedule(delayMs: number, task: () => void): ScheduledTask {
    return new NodeScheduledTask(setTimeout(task, delayMs));
  }
}
