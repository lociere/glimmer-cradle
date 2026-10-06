import { validateJobRequest, type JobRetryMode } from '../execution/job.js';
import { initialScheduleDue, type JobSchedule } from '../scheduling/schedule.js';

export interface JobTriggerDefinition {
  readonly trigger_id: string;
  readonly scope_id: string;
  readonly goal_id: string;
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly retry_mode: JobRetryMode;
  readonly max_attempts: number;
  readonly schedule: JobSchedule | null;
}

export interface JobTrigger {
  readonly definition: JobTriggerDefinition;
  readonly revision: number;
  readonly enabled: boolean;
  readonly next_due_at: number | null;
  readonly last_due_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface JobTriggerEvent {
  readonly event_id: string;
  readonly occurred_at: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export function validateTriggerDefinition(definition: JobTriggerDefinition): void {
  if (!definition.trigger_id?.trim()) throw new Error('Job trigger identity 不得为空');
  validateJobRequest({ ...definition, job_id: definition.trigger_id, idempotency_key: definition.trigger_id,
    due_at: definition.schedule === null ? 0 : initialScheduleDue(definition.schedule) });
}
