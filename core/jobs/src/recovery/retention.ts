import type { JobClockPort } from '../ports/clock-port.js';
import type { JobStorePort } from '../ports/job-store-port.js';

export class JobRetentionController {
  public constructor(private readonly store: JobStorePort, private readonly clock: JobClockPort, private readonly epoch: number) {}

  public prune(retainMs: number): number {
    const now = this.clock.now();
    if (!Number.isSafeInteger(retainMs) || retainMs < 0 || !Number.isSafeInteger(now) || now < 0) {
      throw new Error('Job retention window 无效');
    }
    // 合法长保留期可早于 Unix epoch；此时没有任何事实到期，不能使用负截止点或清掉 t=0。
    return now < retainMs ? 0 : this.store.pruneTerminal(this.epoch, now - retainMs);
  }
}
