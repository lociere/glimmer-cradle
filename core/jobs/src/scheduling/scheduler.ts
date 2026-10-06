import type { JobController } from '../execution/job-controller.js';
import type { JobClockPort } from '../ports/clock-port.js';
import type { JobStorePort } from '../ports/job-store-port.js';

/** Host 显式驱动一次 tick；进程计时器与生命周期由 App 拥有，不在 Core 偷开常驻任务。 */
export class JobScheduler {
  public constructor(private readonly store: JobStorePort, private readonly controller: JobController,
    private readonly clock: JobClockPort, private readonly epoch: number,
    private readonly ownerId: string, private readonly leaseMs: number, private readonly kind?: string) {}

  public async runDue(limit: number, signal?: AbortSignal): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Job tick limit 无效');
    signal?.throwIfAborted();
    if (this.controller.isAccepting) this.store.materializeDue(this.epoch, this.clock.now(), limit);
    let count = 0;
    while (count < limit && this.controller.isAccepting) {
      signal?.throwIfAborted();
      const claim = this.store.claim(this.epoch, this.ownerId, this.clock.now(), this.leaseMs, this.kind);
      if (!claim) break;
      await this.controller.execute(claim);
      count += 1;
    }
    return count;
  }
}
