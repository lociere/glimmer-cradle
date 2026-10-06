import type { JobClockPort } from '../ports/clock-port.js';
import type { JobStorePort } from '../ports/job-store-port.js';

export class JobRetentionController {
  public constructor(private readonly store: JobStorePort, private readonly clock: JobClockPort, private readonly epoch: number) {}

  public prune(retainMs: number): number {
    const now = this.clock.now();
    if (!Number.isSafeInteger(retainMs) || retainMs < 0 || !Number.isSafeInteger(now) || now < retainMs) {
      throw new Error('Job retention window 无效');
    }
    return this.store.pruneTerminal(this.epoch, now - retainMs);
  }
}
