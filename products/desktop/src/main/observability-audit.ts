import fs from 'fs/promises';
import path from 'path';
import type { DesktopProjectRoots } from './project-paths';
import { resolveDesktopObservabilityPath } from './project-paths';

const SCHEMA_VERSION = '1.0.0';
const DESKTOP_RUNTIME_ID = `desktop:${process.pid}`;

export interface DesktopAuditRecordInput {
  action: string;
  target_kind: string;
  outcome: string;
  trace_id?: string;
  target_name?: string | null;
  actor_kind?: string | null;
  actor_id?: string | null;
  module?: string | null;
  scene_id?: string | null;
  extension_id?: string | null;
  provider_id?: string | null;
  skill_id?: string | null;
  tool_name?: string | null;
  risk_level?: string | null;
  reason?: string | null;
  diagnostic_hint?: string | null;
  duration_ms?: number | null;
  attributes?: Record<string, unknown>;
}

export async function appendDesktopAuditRecord(
  roots: DesktopProjectRoots,
  input: DesktopAuditRecordInput,
): Promise<void> {
  if (process.env.NODE_ENV === 'test' && process.env.GLIMMER_CRADLE_FORCE_OBSERVABILITY_IO !== '1') {
    return;
  }
  const dir = resolveDesktopObservabilityPath(roots, 'audit');
  const filePath = path.join(dir, 'audit-desktop.jsonl');
  await fs.mkdir(dir, { recursive: true });
  const record = {
    timestamp: new Date().toISOString(),
    action: input.action,
    target_kind: input.target_kind,
    target_name: input.target_name ?? null,
    actor_kind: input.actor_kind ?? 'desktop_shell',
    actor_id: input.actor_id ?? null,
    owner: 'desktop_shell',
    module: input.module ?? 'ipc-handlers',
    runtime_id: DESKTOP_RUNTIME_ID,
    trace_id: input.trace_id ?? `desktop-audit-${Date.now()}`,
    span_id: null,
    scene_id: input.scene_id ?? null,
    extension_id: input.extension_id ?? null,
    provider_id: input.provider_id ?? null,
    skill_id: input.skill_id ?? null,
    tool_name: input.tool_name ?? null,
    risk_level: input.risk_level ?? null,
    outcome: input.outcome,
    reason: input.reason ?? null,
    diagnostic_hint: input.diagnostic_hint ?? null,
    artifact_ref: null,
    details_ref: null,
    duration_ms: input.duration_ms ?? null,
    schema_version: SCHEMA_VERSION,
    attributes: input.attributes ?? {},
  };
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}
