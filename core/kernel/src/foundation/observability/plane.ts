import fs from 'fs';
import path from 'path';
import type { AuditRecord, EventOutcome, ObservabilityEvent } from '@glimmer-cradle/protocol';
import { getCurrentSpanId, getCurrentTraceId, newTraceId } from '../logger/trace-context';
import { resolveAuditDir, resolveEventsDir } from '../utils/path-utils';

const SCHEMA_VERSION = '1.0.0';
const KERNEL_RUNTIME_ID = `kernel:${process.pid}`;

export const OBSERVABILITY_EVENT_TYPES = {
  SKILL_INVOCATION_SUCCEEDED: 'skill.invocation.succeeded',
  SKILL_INVOCATION_FAILED: 'skill.invocation.failed',
  SKILL_INVOCATION_POLICY_DENIED: 'skill.invocation.policy_denied',
  LLM_INVOCATION_SUCCEEDED: 'llm.invocation.succeeded',
  LLM_INVOCATION_FAILED: 'llm.invocation.failed',
  DLQ_ENQUEUED: 'dlq.message.enqueued',
} as const;

type RegisteredEventType = typeof OBSERVABILITY_EVENT_TYPES[keyof typeof OBSERVABILITY_EVENT_TYPES];

interface EventRegistration {
  owner: string;
  module: string;
  defaultAction: string;
}

const EVENT_REGISTRY: Record<RegisteredEventType, EventRegistration> = {
  [OBSERVABILITY_EVENT_TYPES.SKILL_INVOCATION_SUCCEEDED]: {
    owner: 'skill_plane',
    module: 'skill-invocation-gateway',
    defaultAction: 'invoke',
  },
  [OBSERVABILITY_EVENT_TYPES.SKILL_INVOCATION_FAILED]: {
    owner: 'skill_plane',
    module: 'skill-invocation-gateway',
    defaultAction: 'invoke',
  },
  [OBSERVABILITY_EVENT_TYPES.SKILL_INVOCATION_POLICY_DENIED]: {
    owner: 'skill_plane',
    module: 'skill-invocation-gateway',
    defaultAction: 'invoke',
  },
  [OBSERVABILITY_EVENT_TYPES.LLM_INVOCATION_SUCCEEDED]: {
    owner: 'cognition',
    module: 'llm-engine',
    defaultAction: 'generate',
  },
  [OBSERVABILITY_EVENT_TYPES.LLM_INVOCATION_FAILED]: {
    owner: 'cognition',
    module: 'llm-engine',
    defaultAction: 'generate',
  },
  [OBSERVABILITY_EVENT_TYPES.DLQ_ENQUEUED]: {
    owner: 'kernel',
    module: 'dead-letter-queue',
    defaultAction: 'enqueue',
  },
};

type EventLevel = ObservabilityEvent['level'];

export interface ObservabilityEventInput extends Partial<ObservabilityEvent> {
  level: EventLevel;
}

export interface AuditRecordInput extends Partial<AuditRecord> {
  action: string;
  target_kind: string;
  outcome: EventOutcome;
  owner: string;
}

export function recordObservabilityEvent(
  eventType: RegisteredEventType,
  input: ObservabilityEventInput,
): ObservabilityEvent {
  const registration = EVENT_REGISTRY[eventType];
  const event: ObservabilityEvent = {
    timestamp: input.timestamp ?? new Date().toISOString(),
    level: input.level,
    event_type: eventType,
    event_action: input.event_action ?? registration.defaultAction,
    event_outcome: input.event_outcome ?? null,
    event_reason: input.event_reason ?? null,
    owner: input.owner ?? registration.owner,
    module: input.module ?? registration.module,
    runtime_id: input.runtime_id ?? KERNEL_RUNTIME_ID,
    phase: input.phase ?? null,
    trace_id: input.trace_id ?? getCurrentTraceId() ?? newTraceId(),
    span_id: input.span_id ?? getCurrentSpanId() ?? null,
    parent_span_id: input.parent_span_id ?? null,
    scene_id: input.scene_id ?? null,
    extension_id: input.extension_id ?? null,
    provider_id: input.provider_id ?? null,
    skill_id: input.skill_id ?? null,
    tool_name: input.tool_name ?? null,
    process_id: input.process_id ?? null,
    error_code: input.error_code ?? null,
    error_kind: input.error_kind ?? null,
    diagnostic_hint: input.diagnostic_hint ?? null,
    artifact_ref: input.artifact_ref ?? null,
    details_ref: input.details_ref ?? null,
    duration_ms: input.duration_ms ?? null,
    schema_version: input.schema_version ?? SCHEMA_VERSION,
    attributes: input.attributes ?? {},
  };
  appendJsonl(resolveEventsDir(), 'kernel.jsonl', event);
  return event;
}

export function appendAuditRecord(input: AuditRecordInput): AuditRecord {
  const record: AuditRecord = {
    timestamp: input.timestamp ?? new Date().toISOString(),
    action: input.action,
    target_kind: input.target_kind,
    target_name: input.target_name ?? null,
    actor_kind: input.actor_kind ?? null,
    actor_id: input.actor_id ?? null,
    owner: input.owner,
    module: input.module ?? null,
    runtime_id: input.runtime_id ?? KERNEL_RUNTIME_ID,
    trace_id: input.trace_id ?? getCurrentTraceId() ?? newTraceId(),
    span_id: input.span_id ?? getCurrentSpanId() ?? null,
    scene_id: input.scene_id ?? null,
    extension_id: input.extension_id ?? null,
    provider_id: input.provider_id ?? null,
    skill_id: input.skill_id ?? null,
    tool_name: input.tool_name ?? null,
    risk_level: input.risk_level ?? null,
    outcome: input.outcome,
    reason: input.reason ?? null,
    diagnostic_hint: input.diagnostic_hint ?? null,
    artifact_ref: input.artifact_ref ?? null,
    details_ref: input.details_ref ?? null,
    duration_ms: input.duration_ms ?? null,
    schema_version: input.schema_version ?? SCHEMA_VERSION,
    attributes: input.attributes ?? {},
  };
  appendJsonl(resolveAuditDir(), 'kernel.jsonl', record);
  return record;
}

function appendJsonl(dir: string, fileName: string, payload: unknown): void {
  if (process.env.NODE_ENV === 'test' && process.env.GLIMMER_CRADLE_FORCE_OBSERVABILITY_IO !== '1') {
    return;
  }
  const filePath = path.join(dir, fileName);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf-8');
}
