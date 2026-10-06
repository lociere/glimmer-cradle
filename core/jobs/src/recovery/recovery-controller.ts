import type { JobClockPort } from '../ports/clock-port.js';
import type { JobStorePort } from '../ports/job-store-port.js';
import type { RetryPolicy } from './retry-policy.js';

export class JobRecoveryController {
  public constructor(private readonly store: JobStorePort, private readonly clock: JobClockPort,
    private readonly epoch: number, private readonly policy: RetryPolicy) {}

  public recoverExpired(): number { return this.store.recoverExpired(this.epoch, this.clock.now(), this.policy); }
}
