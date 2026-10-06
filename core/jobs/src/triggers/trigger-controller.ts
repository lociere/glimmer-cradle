import type { JobRequest } from '../execution/job.js';
import type { JobClockPort } from '../ports/clock-port.js';
import type { JobStorePort, JobSubmission } from '../ports/job-store-port.js';

export class JobTriggerController {
  public constructor(private readonly store: JobStorePort, private readonly clock: JobClockPort, private readonly epoch: number) {}

  public submit(request: JobRequest): JobSubmission { return this.store.enqueue(request, this.epoch, this.clock.now()); }
}
