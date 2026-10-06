import type { JobRequest } from '../execution/job.js';
import type { JobClockPort } from '../ports/clock-port.js';
import type { JobStorePort, JobSubmission } from '../ports/job-store-port.js';
import type { JobTrigger, JobTriggerDefinition, JobTriggerEvent } from './trigger.js';

export class JobTriggerController {
  public constructor(private readonly store: JobStorePort, private readonly clock: JobClockPort, private readonly epoch: number) {}

  public submit(request: JobRequest): JobSubmission { return this.store.enqueue(request, this.epoch, this.clock.now()); }
  public register(definition: JobTriggerDefinition): JobTrigger {
    return this.store.registerTrigger(definition, this.epoch, this.clock.now());
  }
  public emit(triggerId: string, event: JobTriggerEvent): JobSubmission {
    return this.store.emitEvent(triggerId, event, this.epoch, this.clock.now());
  }
  public setEnabled(triggerId: string, expectedRevision: number, enabled: boolean): JobTrigger | null {
    return this.store.setTriggerEnabled(triggerId, this.epoch, expectedRevision, enabled, this.clock.now());
  }
}
