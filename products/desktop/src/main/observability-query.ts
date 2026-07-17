import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type {
  AuditRecord,
  ExtensionRuntimeProjection,
  ModelInvocationRecord,
  ObservabilityConfig,
  ObservabilityEvent,
  RuntimeReadinessCatalog,
} from '@glimmer-cradle/protocol';
import {
  fileExistsSync,
  type DesktopProjectRoots,
  resolveDesktopConfigChildPath,
  resolveDesktopObservabilityPath,
  resolveDesktopProjectPath,
  resolveDesktopStatePath,
} from './project-paths';

const OBSERVABILITY_INDEX_SCHEMA_VERSION = 'glimmer-observability-index-v2';
const INDEX_RECOVERY_NOTE = 'JSONL records remain the source of truth; direct scanning is the recovery path when the SQLite projection is unavailable.';

const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  console_format: 'pretty',
  file_format: 'json',
  level: 'info',
  module_levels: {},
  rotation: {
    main_size_mb: 10,
    main_keep: 5,
    error_size_mb: 5,
    error_keep: 3,
  },
  model_invocations: {
    capture_mode: 'summary',
    full_retention_days: 3,
    redact_secrets: true,
  },
  retention: {
    events_days: 14,
    traces_days: 14,
    metrics_days: 14,
    audit_days: 30,
    model_invocation_days: 14,
    application_log_days: 7,
    dlq_days: 30,
    bundles_days: 7,
  },
  index: {
    mode: 'sqlite',
    db_path: 'observability/index/observability.db',
  },
  bundles: {
    export_dir: 'observability/bundles',
    process_tail_bytes: 8192,
    include_model_invocation_captures: false,
  },
};

export interface ObservabilityProcessLogRef {
  id: string;
  owner: string;
  label: string;
  source: 'known_process' | 'details_ref' | 'artifact_ref' | 'extension_projection';
  path: string;
  exists: boolean;
}

export interface ObservabilityRecentErrorSummary {
  trace_id: string;
  timestamp: string;
  source: 'event' | 'audit' | 'model-invocation' | 'dlq';
  title: string;
  summary: string;
  owner: string;
  runtime_id?: string;
  event_type?: string;
  action?: string;
  outcome?: string | null;
  error_code?: string | null;
  diagnostic_hint?: string | null;
  extension_id?: string | null;
  provider_id?: string | null;
  process_log_refs: ObservabilityProcessLogRef[];
}

export interface ObservabilityEventSummary {
  timestamp: string;
  level: string;
  event_type: string;
  event_action?: string | null;
  event_outcome?: string | null;
  owner: string;
  module: string;
  runtime_id: string;
  phase?: string | null;
  trace_id: string;
  error_code?: string | null;
  diagnostic_hint?: string | null;
  details_ref?: string | null;
  artifact_ref?: string | null;
  extension_id?: string | null;
  provider_id?: string | null;
}

export interface ObservabilityAuditSummary {
  timestamp: string;
  action: string;
  target_kind: string;
  target_name?: string | null;
  owner: string;
  runtime_id: string;
  trace_id: string;
  outcome: string;
  reason?: string | null;
  diagnostic_hint?: string | null;
  details_ref?: string | null;
  artifact_ref?: string | null;
  extension_id?: string | null;
  provider_id?: string | null;
}

export interface ObservabilityModelInvocationSummary {
  timestamp: string;
  invocation_id: string;
  trace_id: string;
  purpose: string;
  capture_category: string;
  capture_mode: string;
  owner: string;
  runtime_id: string;
  provider_id: string;
  model_id: string;
  outcome: string;
  duration_ms?: number | null;
  prompt_chars?: number | null;
  response_chars?: number | null;
  prompt_hash?: string | null;
  response_hash?: string | null;
  error_code?: string | null;
  error_summary?: string | null;
  provider_payload_ref?: string | null;
  raw_response_ref?: string | null;
  prompt_text_ref?: string | null;
  response_text_ref?: string | null;
  normalized_text_ref?: string | null;
}

export interface ObservabilityDlqSummary {
  id: number;
  trace_id: string;
  event_type: string;
  owner: string;
  failure_phase: string;
  error_code: string;
  status: string;
  created_at: string;
  resolved_at?: string | null;
  resolution?: string | null;
  diagnostic_hint: string;
  redacted_payload_summary: string;
  replay_command: string;
  source_path: string;
}

export interface ObservabilitySpanSummary {
  source: 'kernel' | 'cognition' | 'unknown';
  name: string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string | null;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  status: string;
  file_ref: string;
}

export interface ObservabilityMetricRef {
  id: string;
  source: 'kernel' | 'cognition' | 'unknown';
  path: string;
  note: string;
}

export interface ObservabilityStorageStatus {
  mode: 'jsonl_scan' | 'sqlite_index';
  owner: 'desktop-main';
  index_path: string;
  pending_index_path?: string | null;
  refreshed_at?: string | null;
  source_fingerprint?: string | null;
  recovery_note: string;
}

export interface ObservabilityRetentionPolicy {
  events_days: number;
  traces_days: number;
  metrics_days: number;
  audit_days: number;
  model_invocation_days: number;
  model_invocation_capture_days: number;
  application_log_days: number;
  dlq_days: number;
  bundles_days: number;
  bundle_export_dir: string;
  include_model_invocation_captures: boolean;
  process_tail_bytes: number;
}

export interface ObservabilityMaintenanceStatus {
  generated_at: string;
  storage: ObservabilityStorageStatus;
  retention: ObservabilityRetentionPolicy;
  model_invocation_capture_mode: 'off' | 'summary' | 'full';
  notes: string[];
}

export interface ObservabilityTraceProjection {
  generated_at: string;
  trace_id: string;
  storage: ObservabilityStorageStatus;
  events: ObservabilityEventSummary[];
  audit: ObservabilityAuditSummary[];
  modelInvocations: ObservabilityModelInvocationSummary[];
  dlq: ObservabilityDlqSummary[];
  spans: ObservabilitySpanSummary[];
  process_log_refs: ObservabilityProcessLogRef[];
  metric_refs: ObservabilityMetricRef[];
  related_runtime_ids: string[];
  related_extensions: string[];
  related_providers: string[];
  notes: string[];
}

export interface ObservabilityBundleManifestSection {
  id: string;
  path: string;
  record_count: number;
}

export interface ObservabilityBundleManifest {
  schema_version: '1.0.0';
  bundle_id: string;
  exported_at: string;
  trace_id: string;
  storage_mode: ObservabilityStorageStatus['mode'];
  trace_summary: {
    events: number;
    audit: number;
    modelInvocations: number;
    dlq: number;
    spans: number;
    process_logs: number;
    related_runtime_ids: string[];
    related_extensions: string[];
    related_providers: string[];
  };
  retention: ObservabilityRetentionPolicy;
  modelInvocations: {
    capture_mode: 'off' | 'summary' | 'full';
    include_model_invocation_captures: boolean;
    full_capture_count: number;
  };
  sections: ObservabilityBundleManifestSection[];
  notes: string[];
}

export interface ObservabilityBundleExportResult {
  trace_id: string;
  bundle_id: string;
  exported_at: string;
  bundle_root: string;
  manifest_path: string;
  included_sections: string[];
  process_log_snippets: number;
  model_invocation_captures: number;
  storage: ObservabilityStorageStatus;
  notes: string[];
}

export interface ObservabilityCleanupBucketResult {
  id: 'events' | 'traces' | 'metrics' | 'audit' | 'model_invocation_records' | 'model_invocation_captures' | 'process' | 'dlq' | 'bundles' | 'index';
  retention_days: number;
  deleted_records: number;
  deleted_files: number;
  reclaimed_bytes: number;
  note: string;
}

export interface ObservabilityCleanupResult {
  executed_at: string;
  storage: ObservabilityStorageStatus;
  retention: ObservabilityRetentionPolicy;
  buckets: ObservabilityCleanupBucketResult[];
  protected_paths: string[];
  notes: string[];
}

export interface ObservabilityQueryContext {
  extensionRuntimeProjections?: ExtensionRuntimeProjection[];
  runtimeReadiness?: RuntimeReadinessCatalog | null;
}

interface StoredSpanRecord extends ObservabilitySpanSummary {}

interface DeadLetterRow {
  readonly id: number;
  readonly trace_id: string;
  readonly event_type: string;
  readonly failure_phase: string;
  readonly error_code: string;
  readonly owner: string;
  readonly source_path: string;
  readonly redacted_payload_summary: string;
  readonly replay_command: string;
  readonly diagnostic_hint: string;
  readonly status: string;
  readonly created_at: string;
  readonly resolved_at: string;
  readonly resolution: string;
}

interface ObservabilitySnapshot {
  events: ObservabilityEvent[];
  audit: AuditRecord[];
  modelInvocations: ModelInvocationRecord[];
  dlq: DeadLetterRow[];
  spans: StoredSpanRecord[];
}

interface ObservabilityDataSource {
  storage: ObservabilityStorageStatus;
  mode: 'scan' | 'sqlite';
  db_path?: string;
  snapshot?: ObservabilitySnapshot;
}

type SqliteStatement = {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => unknown;
  run: (...params: unknown[]) => unknown;
};

type SqliteDatabase = {
  prepare: (sql: string) => SqliteStatement;
  exec: (sql: string) => void;
  close: () => void;
};

type SqliteDatabaseConstructor = new (
  filename: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => SqliteDatabase;

type RuntimeProjectionSummary = {
  generated_at: string;
  runtimes: Array<{
    runtime_id: string;
    owner: string;
    state: string;
    phase: string;
    summary: string;
    blocking: boolean;
  }>;
  extensions: Array<{
    extension_id: string;
    display_name: string;
    operational_state: string;
    diagnostic_entries: number;
    log_locations: string[];
  }>;
};

export async function getObservabilityMaintenanceStatus(
  roots: DesktopProjectRoots,
): Promise<ObservabilityMaintenanceStatus> {
  const config = await loadObservabilityConfig(roots);
  const source = await loadObservabilityDataSource(roots, config);

  return {
    generated_at: new Date().toISOString(),
    storage: source.storage,
    retention: buildRetentionPolicy(roots, config),
    model_invocation_capture_mode: config.model_invocations.capture_mode,
    notes: [
      source.storage.mode === 'sqlite_index'
        ? 'Desktop main serves diagnostics from observability.db and keeps JSONL as the source of truth.'
        : 'Desktop main is still serving diagnostics from direct JSONL/DLQ scans.',
      'Cleanup only targets regenerable observability data. Cognition state, Experience, and imported user resources stay out of scope.',
      'Complete model captures remain opt-in and never enter ordinary logs, DLQ records, or bundles unless bundle policy explicitly allows them.',
    ],
  };
}

export async function queryObservabilityTrace(
  roots: DesktopProjectRoots,
  traceId: string,
  context: ObservabilityQueryContext = {},
): Promise<ObservabilityTraceProjection> {
  const normalizedTraceId = traceId.trim();
  if (!normalizedTraceId) {
    throw new Error('trace_id is required');
  }

  const config = await loadObservabilityConfig(roots);
  const source = await loadObservabilityDataSource(roots, config);
  if (source.mode === 'sqlite' && source.db_path) {
    const indexed = readIndexedTraceProjection(roots, source.db_path, normalizedTraceId, context, source.storage);
    if (indexed) return indexed;
  }

  const snapshot = source.snapshot ?? await readObservabilitySnapshot(roots);
  return buildTraceProjectionFromSnapshot(roots, normalizedTraceId, context, source.storage, snapshot);
}

export async function listRecentObservabilityErrors(
  roots: DesktopProjectRoots,
  context: ObservabilityQueryContext = {},
  limit = 8,
): Promise<ObservabilityRecentErrorSummary[]> {
  const config = await loadObservabilityConfig(roots);
  const source = await loadObservabilityDataSource(roots, config);
  if (source.mode === 'sqlite' && source.db_path) {
    const indexed = readIndexedRecentErrors(roots, source.db_path, source.storage, context, limit);
    if (indexed) return indexed;
  }

  const snapshot = source.snapshot ?? await readObservabilitySnapshot(roots);
  return buildRecentErrorsFromSnapshot(roots, context, snapshot, limit);
}

export async function listRecentObservabilityEvents(
  roots: DesktopProjectRoots,
  limit = 200,
): Promise<ObservabilityEventSummary[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 500));
  const config = await loadObservabilityConfig(roots);
  const source = await loadObservabilityDataSource(roots, config);
  let structuredEvents: ObservabilityEventSummary[] = [];
  if (source.mode === 'sqlite' && source.db_path) {
    const indexed = readIndexedRecentEvents(source.db_path, boundedLimit);
    if (indexed) structuredEvents = indexed;
  }

  if (structuredEvents.length === 0) {
    const snapshot = source.snapshot ?? await readObservabilitySnapshot(roots);
    structuredEvents = snapshot.events.map(toEventSummary);
  }

  const processEvents = await readRecentProcessLogEvents(roots, boundedLimit);
  const unique = new Map<string, ObservabilityEventSummary>();
  for (const record of [...structuredEvents, ...processEvents].sort(compareTimestampDesc)) {
    const key = [record.timestamp, record.runtime_id, record.module, record.event_type, record.trace_id].join(':');
    if (!unique.has(key)) unique.set(key, record);
    if (unique.size >= boundedLimit) break;
  }
  return Array.from(unique.values());
}

const PROCESS_LOG_EVENT_SOURCES = [
  { runtimeId: 'kernel', owner: 'kernel', path: ['logs', 'application', 'kernel.jsonl'] },
  { runtimeId: 'cognition', owner: 'cognition', path: ['logs', 'application', 'cognition.console.log'] },
  { runtimeId: 'audio.tts', owner: 'engine', path: ['logs', 'application', 'audio-tts.console.log'] },
  { runtimeId: 'audio.asr', owner: 'engine', path: ['logs', 'application', 'audio-asr.console.log'] },
  { runtimeId: 'avatar.host', owner: 'avatar', path: ['logs', 'application', 'avatar-host.console.log'] },
] as const;

async function readRecentProcessLogEvents(
  roots: DesktopProjectRoots,
  limit: number,
): Promise<ObservabilityEventSummary[]> {
  const records = await Promise.all(PROCESS_LOG_EVENT_SOURCES.map(async (source) => {
    const filePath = resolveDesktopObservabilityPath(roots, ...source.path);
    const lines = await readTailLines(filePath, 256 * 1024);
    return lines.flatMap((line) => {
      try {
        const payload = JSON.parse(line) as Record<string, unknown>;
        const timestamp = typeof payload.timestamp === 'string' ? payload.timestamp : '';
        if (!timestamp) return [];
        const level = normalizeLogLevel(payload.level);
        const module = stringValue(payload.module) || source.runtimeId;
        const message = stringValue(payload.message);
        return [{
          timestamp,
          level,
          event_type: stringValue(payload.event_type) || module,
          event_action: message || null,
          event_outcome: level === 'error' ? 'failed' : null,
          owner: stringValue(payload.owner) || source.owner,
          module,
          runtime_id: source.runtimeId,
          phase: stringValue(payload.phase) || null,
          trace_id: stringValue(payload.trace_id),
          error_code: stringValue(payload.error_code) || null,
          diagnostic_hint: message || null,
          details_ref: normalizeProjectRelativePath(filePath),
          artifact_ref: stringValue(payload.artifact_ref) || null,
          extension_id: stringValue(payload.extension_id) || null,
          provider_id: stringValue(payload.provider_id) || null,
        } satisfies ObservabilityEventSummary];
      } catch {
        return [];
      }
    });
  }));
  return records.flat().sort(compareTimestampDesc).slice(0, limit);
}

async function readTailLines(filePath: string, maxBytes: number): Promise<string[]> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(filePath, 'r');
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    if (length <= 0) return [];
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    return stat.size > length ? lines.slice(1) : lines;
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function normalizeLogLevel(value: unknown): string {
  const normalized = stringValue(value).toLowerCase();
  if (normalized === 'error' || normalized === 'warn' || normalized === 'debug' || normalized === 'trace') return normalized;
  return 'info';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function exportObservabilityBundle(
  roots: DesktopProjectRoots,
  traceId: string,
  context: ObservabilityQueryContext = {},
): Promise<ObservabilityBundleExportResult> {
  const config = await loadObservabilityConfig(roots);
  const projection = await queryObservabilityTrace(roots, traceId, context);
  const retention = buildRetentionPolicy(roots, config);
  const bundleRootDir = resolveControlledDataPath(roots, config.bundles.export_dir, 'observability/bundles');
  const bundleId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${sanitizeForFileName(traceId, 48)}`;
  const bundleRoot = path.join(bundleRootDir, bundleId);

  await fs.mkdir(bundleRoot, { recursive: true });

  const sections: ObservabilityBundleManifestSection[] = [];
  const sectionIds: string[] = [];

  await writeBundleSection(bundleRoot, 'trace-summary.json', buildBundleTraceSummary(projection), sections, 'trace-summary', 1);
  await writeBundleSection(bundleRoot, 'events.json', projection.events, sections, 'events', projection.events.length);
  await writeBundleSection(bundleRoot, 'spans.json', projection.spans, sections, 'spans', projection.spans.length);
  await writeBundleSection(bundleRoot, 'audit.json', projection.audit, sections, 'audit', projection.audit.length);
  await writeBundleSection(bundleRoot, 'model-invocation-records.json', projection.modelInvocations, sections, 'model-invocation-records', projection.modelInvocations.length);
  await writeBundleSection(bundleRoot, 'dlq-summary.json', projection.dlq, sections, 'dlq-summary', projection.dlq.length);
  await writeBundleSection(bundleRoot, 'process-log-refs.json', projection.process_log_refs, sections, 'process-log-refs', projection.process_log_refs.length);

  const runtimeSummary = buildRuntimeProjectionSummary(context, projection);
  await writeBundleSection(bundleRoot, 'runtime-summary.json', runtimeSummary, sections, 'runtime-summary', runtimeSummary.runtimes.length + runtimeSummary.extensions.length);

  const snippetDir = path.join(bundleRoot, 'process-tails');
  const processLogSnippets = await exportProcessLogSnippets(roots, projection.process_log_refs, snippetDir, config.bundles.process_tail_bytes);
  if (processLogSnippets.count > 0) {
    sectionIds.push('process-tails');
  }

  const modelCapturesDir = path.join(bundleRoot, 'model-invocation-captures');
  const completeModelCaptureCount = config.bundles.include_model_invocation_captures
    ? await exportModelInvocationCaptures(roots, projection.modelInvocations, modelCapturesDir)
    : 0;
  if (completeModelCaptureCount > 0) {
    sectionIds.push('model-invocation-captures');
  }

  const manifest: ObservabilityBundleManifest = {
    schema_version: '1.0.0',
    bundle_id: bundleId,
    exported_at: new Date().toISOString(),
    trace_id: projection.trace_id,
    storage_mode: projection.storage.mode,
    trace_summary: buildBundleTraceSummary(projection),
    retention,
    modelInvocations: {
      capture_mode: config.model_invocations.capture_mode,
      include_model_invocation_captures: config.bundles.include_model_invocation_captures,
      full_capture_count: completeModelCaptureCount,
    },
    sections,
    notes: [
      'Bundles are written under controlled data roots only.',
      'Secrets, provider keys, and raw prompts do not enter bundles unless include_model_invocation_captures is explicitly enabled.',
      'Process logs are exported as truncated tails rather than full raw log dumps.',
    ],
  };

  const manifestPath = path.join(bundleRoot, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  sectionIds.push(...sections.map((section) => section.id));

  return {
    trace_id: projection.trace_id,
    bundle_id: bundleId,
    exported_at: manifest.exported_at,
    bundle_root: toRepoRelativePath(roots, bundleRoot),
    manifest_path: toRepoRelativePath(roots, manifestPath),
    included_sections: Array.from(new Set(sectionIds)),
    process_log_snippets: processLogSnippets.count,
    model_invocation_captures: completeModelCaptureCount,
    storage: projection.storage,
    notes: manifest.notes,
  };
}

export async function cleanupObservability(
  roots: DesktopProjectRoots,
): Promise<ObservabilityCleanupResult> {
  const config = await loadObservabilityConfig(roots);
  const retention = buildRetentionPolicy(roots, config);
  const buckets: ObservabilityCleanupBucketResult[] = [];

  buckets.push(await pruneJsonlDirectory(
    resolveDesktopObservabilityPath(roots, 'logs', 'events'),
    ['timestamp'],
    retention.events_days,
    'events',
    'Structured runtime events older than the retention window.',
  ));
  buckets.push(await pruneJsonlDirectory(
    resolveDesktopObservabilityPath(roots, 'traces'),
    ['started_at', 'ended_at'],
    retention.traces_days,
    'traces',
    'Span JSONL rows older than the retention window.',
  ));
  buckets.push(await pruneJsonlDirectory(
    resolveDesktopObservabilityPath(roots, 'metrics'),
    ['timestamp'],
    retention.metrics_days,
    'metrics',
    'Metrics rows older than the retention window.',
  ));
  buckets.push(await pruneJsonlDirectory(
    resolveDesktopObservabilityPath(roots, 'logs', 'audit'),
    ['timestamp'],
    retention.audit_days,
    'audit',
    'Audit rows older than the retention window.',
  ));
  buckets.push(await pruneJsonlDirectory(
    resolveDesktopObservabilityPath(roots, 'model-invocations', 'records'),
    ['timestamp'],
    retention.model_invocation_days,
    'model_invocation_records',
    'model invocation summary rows older than the retention window.',
  ));
  buckets.push(await pruneFilesByMtime(
    resolveDesktopObservabilityPath(roots, 'model-invocations', 'captures'),
    retention.model_invocation_capture_days,
    'model_invocation_captures',
    'Complete model captures older than the stricter full retention window.',
  ));
  buckets.push(await pruneFilesByMtime(
    resolveDesktopObservabilityPath(roots, 'logs', 'application'),
    retention.application_log_days,
    'process',
    'Noisy subprocess logs older than the retention window.',
  ));
  buckets.push(pruneDeadLetters(
    roots,
    retention.dlq_days,
  ));
  buckets.push(await pruneFilesByMtime(
    resolveControlledDataPath(roots, config.bundles.export_dir, 'observability/bundles'),
    retention.bundles_days,
    'bundles',
    'Diagnostic bundles older than the retention window.',
  ));
  buckets.push(await resetObservabilityIndex(roots, config));

  const storage = (await loadObservabilityDataSource(roots, config)).storage;
  return {
    executed_at: new Date().toISOString(),
    storage,
    retention,
    buckets,
    protected_paths: [
      'data/state/cognition/**',
      'data/models/**',
      'data/packages/**',
      'data/state/extensions/**',
    ],
    notes: [
      'Cleanup never touches Cognition state, Experience, or imported user resources.',
      'DLQ cleanup only removes resolved or replayed rows older than the configured retention. Pending rows stay intact.',
      'After cleanup, the SQLite observability index is rebuilt on the next diagnostics query.',
    ],
  };
}

async function loadObservabilityDataSource(
  roots: DesktopProjectRoots,
  config: ObservabilityConfig,
): Promise<ObservabilityDataSource> {
  if (config.index.mode === 'sqlite') {
    const indexed = await ensureObservabilityIndex(roots, config);
    if (indexed) {
      return {
        storage: indexed.storage,
        mode: 'sqlite',
        db_path: indexed.db_path,
      };
    }
  }

  return {
    storage: buildJsonlStorageStatus(roots, config),
    mode: 'scan',
    snapshot: await readObservabilitySnapshot(roots),
  };
}

async function ensureObservabilityIndex(
  roots: DesktopProjectRoots,
  config: ObservabilityConfig,
): Promise<{ storage: ObservabilityStorageStatus; db_path: string } | null> {
  const Database = requireBetterSqlite3();
  if (!Database) return null;

  const dbPath = resolveControlledDataPath(roots, config.index.db_path, 'observability/index/observability.db');
  const fingerprint = await computeObservabilitySourceFingerprint(roots);
  const current = readIndexMetadata(dbPath);
  if (
    current
    && current.schema_version === OBSERVABILITY_INDEX_SCHEMA_VERSION
    && current.source_fingerprint === fingerprint
  ) {
    return {
      db_path: dbPath,
      storage: buildSqliteStorageStatus(roots, dbPath, current.refreshed_at, current.source_fingerprint),
    };
  }

  const snapshot = await readObservabilitySnapshot(roots);
  await writeObservabilityIndex(roots, dbPath, fingerprint, snapshot);
  return {
    db_path: dbPath,
    storage: buildSqliteStorageStatus(roots, dbPath, new Date().toISOString(), fingerprint),
  };
}

function buildTraceProjectionFromSnapshot(
  roots: DesktopProjectRoots,
  traceId: string,
  context: ObservabilityQueryContext,
  storage: ObservabilityStorageStatus,
  snapshot: ObservabilitySnapshot,
): ObservabilityTraceProjection {
  const events = snapshot.events
    .filter((record) => record.trace_id === traceId)
    .map(toEventSummary)
    .sort(compareTimestampDesc);
  const audit = snapshot.audit
    .filter((record) => record.trace_id === traceId)
    .map(toAuditSummary)
    .sort(compareTimestampDesc);
  const modelInvocations = snapshot.modelInvocations
    .filter((record) => record.trace_id === traceId)
    .map(toModelInvocationSummary)
    .sort(compareTimestampDesc);
  const dlq = snapshot.dlq
    .filter((record) => record.trace_id === traceId)
    .map(toDlqSummary)
    .sort(compareCreatedAtDesc);
  const spans = snapshot.spans
    .filter((record) => record.trace_id === traceId)
    .sort(compareSpanStartedAtDesc);

  return buildTraceProjectionFromSummaries(roots, traceId, context, storage, {
    events,
    audit,
    modelInvocations,
    dlq,
    spans,
  });
}

function buildTraceProjectionFromSummaries(
  roots: DesktopProjectRoots,
  traceId: string,
  context: ObservabilityQueryContext,
  storage: ObservabilityStorageStatus,
  payload: {
    events: ObservabilityEventSummary[];
    audit: ObservabilityAuditSummary[];
    modelInvocations: ObservabilityModelInvocationSummary[];
    dlq: ObservabilityDlqSummary[];
    spans: ObservabilitySpanSummary[];
  },
): ObservabilityTraceProjection {
  const relatedExtensions = collectDistinct([
    ...payload.events.map((record) => record.extension_id ?? ''),
    ...payload.audit.map((record) => record.extension_id ?? ''),
  ]);

  const processLogRefs = dedupeProcessLogRefs([
    ...collectProcessRefsFromEventSummaries(roots, payload.events),
    ...collectProcessRefsFromAuditSummaries(roots, payload.audit),
    ...collectProcessRefsFromModelInvocations(roots, payload.modelInvocations),
    ...collectProcessRefsFromDlqSummaries(roots, payload.dlq),
    ...collectProjectionProcessRefs(
      roots,
      context.extensionRuntimeProjections ?? [],
      new Set(relatedExtensions),
    ),
  ]);

  return {
    generated_at: new Date().toISOString(),
    trace_id: traceId,
    storage,
    events: payload.events,
    audit: payload.audit,
    modelInvocations: payload.modelInvocations,
    dlq: payload.dlq,
    spans: payload.spans,
    process_log_refs: processLogRefs,
    metric_refs: collectMetricRefs(roots),
    related_runtime_ids: collectDistinct([
      ...payload.events.map((record) => record.runtime_id),
      ...payload.audit.map((record) => record.runtime_id),
      ...payload.modelInvocations.map((record) => record.runtime_id),
    ]),
    related_extensions: relatedExtensions,
    related_providers: collectDistinct([
      ...payload.events.map((record) => record.provider_id ?? ''),
      ...payload.audit.map((record) => record.provider_id ?? ''),
      ...payload.modelInvocations.map((record) => record.provider_id),
    ]),
    notes: buildProjectionNotes(storage),
  };
}

function buildRecentErrorsFromSnapshot(
  roots: DesktopProjectRoots,
  context: ObservabilityQueryContext,
  snapshot: ObservabilitySnapshot,
  limit: number,
): ObservabilityRecentErrorSummary[] {
  const events = snapshot.events.map(toEventSummary);
  const audit = snapshot.audit.map(toAuditSummary);
  const modelInvocations = snapshot.modelInvocations.map(toModelInvocationSummary);
  const dlq = snapshot.dlq.map(toDlqSummary);
  return buildRecentErrorsFromSummaries(roots, context, buildJsonlStorageStatus(roots, DEFAULT_OBSERVABILITY_CONFIG), {
    events,
    audit,
    modelInvocations,
    dlq,
  }, limit);
}

function buildRecentErrorsFromSummaries(
  roots: DesktopProjectRoots,
  context: ObservabilityQueryContext,
  storage: ObservabilityStorageStatus,
  payload: {
    events: ObservabilityEventSummary[];
    audit: ObservabilityAuditSummary[];
    modelInvocations: ObservabilityModelInvocationSummary[];
    dlq: ObservabilityDlqSummary[];
  },
  limit: number,
): ObservabilityRecentErrorSummary[] {
  const candidates: ObservabilityRecentErrorSummary[] = [
    ...payload.events
      .filter(isErrorEventSummary)
      .map((record) => ({
        trace_id: record.trace_id,
        timestamp: record.timestamp,
        source: 'event' as const,
        title: record.event_type,
        summary: record.diagnostic_hint ?? record.error_code ?? record.module,
        owner: record.owner,
        runtime_id: record.runtime_id,
        event_type: record.event_type,
        outcome: record.event_outcome,
        error_code: record.error_code,
        diagnostic_hint: record.diagnostic_hint,
        extension_id: record.extension_id,
        provider_id: record.provider_id,
        process_log_refs: [],
      })),
    ...payload.audit
      .filter(isErrorAuditSummary)
      .map((record) => ({
        trace_id: record.trace_id,
        timestamp: record.timestamp,
        source: 'audit' as const,
        title: record.action,
        summary: record.reason ?? record.diagnostic_hint ?? record.target_kind,
        owner: record.owner,
        runtime_id: record.runtime_id,
        action: record.action,
        outcome: record.outcome,
        diagnostic_hint: record.diagnostic_hint,
        extension_id: record.extension_id,
        provider_id: record.provider_id,
        process_log_refs: [],
      })),
    ...payload.modelInvocations
      .filter((record) => record.outcome === 'failed' || record.outcome === 'partial' || record.outcome === 'timeout')
      .map((record) => ({
        trace_id: record.trace_id,
        timestamp: record.timestamp,
        source: 'model-invocation' as const,
        title: `${record.provider_id} / ${record.model_id}`,
        summary: record.error_summary ?? record.purpose,
        owner: record.owner,
        runtime_id: record.runtime_id,
        outcome: record.outcome,
        error_code: record.error_code,
        provider_id: record.provider_id,
        process_log_refs: [],
      })),
    ...payload.dlq
      .map((record) => ({
        trace_id: record.trace_id,
        timestamp: record.created_at,
        source: 'dlq' as const,
        title: record.event_type,
        summary: record.diagnostic_hint || record.redacted_payload_summary || record.error_code,
        owner: record.owner,
        runtime_id: 'kernel',
        event_type: record.event_type,
        outcome: record.status,
        error_code: record.error_code,
        diagnostic_hint: record.diagnostic_hint,
        process_log_refs: [],
      })),
  ]
    .filter((record) => record.trace_id)
    .sort(compareTimestampDesc);

  const unique = new Map<string, ObservabilityRecentErrorSummary>();
  for (const candidate of candidates) {
    if (unique.has(candidate.trace_id)) continue;
    unique.set(candidate.trace_id, candidate);
    if (unique.size >= limit) break;
  }

  for (const candidate of unique.values()) {
    const projection = buildTraceProjectionFromSummaries(roots, candidate.trace_id, context, storage, {
      events: payload.events.filter((record) => record.trace_id === candidate.trace_id).sort(compareTimestampDesc),
      audit: payload.audit.filter((record) => record.trace_id === candidate.trace_id).sort(compareTimestampDesc),
      modelInvocations: payload.modelInvocations.filter((record) => record.trace_id === candidate.trace_id).sort(compareTimestampDesc),
      dlq: payload.dlq.filter((record) => record.trace_id === candidate.trace_id).sort(compareCreatedAtDesc),
      spans: [],
    });
    candidate.process_log_refs = projection.process_log_refs;
  }

  return Array.from(unique.values());
}

function readIndexedTraceProjection(
  roots: DesktopProjectRoots,
  dbPath: string,
  traceId: string,
  context: ObservabilityQueryContext,
  storage: ObservabilityStorageStatus,
): ObservabilityTraceProjection | null {
  return withIndexDb(dbPath, true, (db) => {
    const events = db.prepare(`
      SELECT timestamp, level, event_type, event_action, event_outcome, owner, module, runtime_id, phase,
             trace_id, error_code, diagnostic_hint, details_ref, artifact_ref, extension_id, provider_id
        FROM events
       WHERE trace_id = ?
       ORDER BY timestamp DESC
    `).all(traceId) as ObservabilityEventSummary[];
    const audit = db.prepare(`
      SELECT timestamp, action, target_kind, target_name, owner, runtime_id, trace_id, outcome, reason,
             diagnostic_hint, details_ref, artifact_ref, extension_id, provider_id
        FROM audit
       WHERE trace_id = ?
       ORDER BY timestamp DESC
    `).all(traceId) as ObservabilityAuditSummary[];
    const modelInvocations = db.prepare(`
      SELECT timestamp, invocation_id, trace_id, purpose, capture_category, capture_mode, owner, runtime_id, provider_id, model_id,
             outcome, duration_ms, prompt_chars, response_chars, prompt_hash, response_hash, error_code,
             error_summary, provider_payload_ref, raw_response_ref, prompt_text_ref, response_text_ref, normalized_text_ref
        FROM model_invocations
       WHERE trace_id = ?
       ORDER BY timestamp DESC
    `).all(traceId) as ObservabilityModelInvocationSummary[];
    const dlq = db.prepare(`
      SELECT id, trace_id, event_type, owner, failure_phase, error_code, status, created_at, resolved_at, resolution,
             diagnostic_hint, redacted_payload_summary, replay_command, source_path
        FROM dlq
       WHERE trace_id = ?
       ORDER BY created_at DESC
    `).all(traceId) as ObservabilityDlqSummary[];
    const spans = db.prepare(`
      SELECT source, name, trace_id, span_id, parent_span_id, started_at, ended_at, duration_ms, status, file_ref
        FROM spans
       WHERE trace_id = ?
       ORDER BY started_at DESC
    `).all(traceId) as ObservabilitySpanSummary[];

    return buildTraceProjectionFromSummaries(roots, traceId, context, storage, {
      events,
      audit,
      modelInvocations,
      dlq,
      spans,
    });
  });
}

function readIndexedRecentEvents(
  dbPath: string,
  limit: number,
): ObservabilityEventSummary[] | null {
  return withIndexDb(dbPath, true, (db) => db.prepare(`
    SELECT timestamp, level, event_type, event_action, event_outcome, owner, module, runtime_id, phase,
           trace_id, error_code, diagnostic_hint, details_ref, artifact_ref, extension_id, provider_id
      FROM events
     ORDER BY timestamp DESC
     LIMIT ?
  `).all(limit) as ObservabilityEventSummary[]);
}

function readIndexedRecentErrors(
  roots: DesktopProjectRoots,
  dbPath: string,
  storage: ObservabilityStorageStatus,
  context: ObservabilityQueryContext,
  limit: number,
): ObservabilityRecentErrorSummary[] | null {
  return withIndexDb(dbPath, true, (db) => {
    const events = db.prepare(`
      SELECT timestamp, level, event_type, event_action, event_outcome, owner, module, runtime_id, phase,
             trace_id, error_code, diagnostic_hint, details_ref, artifact_ref, extension_id, provider_id
        FROM events
       WHERE level = 'error'
          OR event_outcome IN ('failed', 'partial', 'timeout', 'policy_denied')
       ORDER BY timestamp DESC
    `).all() as ObservabilityEventSummary[];
    const audit = db.prepare(`
      SELECT timestamp, action, target_kind, target_name, owner, runtime_id, trace_id, outcome, reason,
             diagnostic_hint, details_ref, artifact_ref, extension_id, provider_id
        FROM audit
       WHERE outcome IN ('failed', 'partial', 'timeout', 'policy_denied', 'cancelled')
       ORDER BY timestamp DESC
    `).all() as ObservabilityAuditSummary[];
    const modelInvocations = db.prepare(`
      SELECT timestamp, invocation_id, trace_id, purpose, capture_category, capture_mode, owner, runtime_id, provider_id, model_id,
             outcome, duration_ms, prompt_chars, response_chars, prompt_hash, response_hash, error_code,
             error_summary, provider_payload_ref, raw_response_ref, prompt_text_ref, response_text_ref, normalized_text_ref
        FROM model_invocations
       WHERE outcome IN ('failed', 'partial', 'timeout')
       ORDER BY timestamp DESC
    `).all() as ObservabilityModelInvocationSummary[];
    const dlq = db.prepare(`
      SELECT id, trace_id, event_type, owner, failure_phase, error_code, status, created_at, resolved_at, resolution,
             diagnostic_hint, redacted_payload_summary, replay_command, source_path
        FROM dlq
       ORDER BY created_at DESC
    `).all() as ObservabilityDlqSummary[];

    return buildRecentErrorsFromSummaries(roots, context, storage, { events, audit, modelInvocations, dlq }, limit);
  });
}

async function readObservabilitySnapshot(roots: DesktopProjectRoots): Promise<ObservabilitySnapshot> {
  const [events, audit, modelInvocations, dlq, spans] = await Promise.all([
    readObservabilityEvents(roots),
    readAuditRecords(roots),
    readModelInvocationRecords(roots),
    readDeadLetters(roots),
    readTraceSpans(roots),
  ]);
  return { events, audit, modelInvocations, dlq, spans };
}

async function readObservabilityEvents(roots: DesktopProjectRoots): Promise<ObservabilityEvent[]> {
  return readJsonlDirectory<ObservabilityEvent>(resolveDesktopObservabilityPath(roots, 'logs', 'events'));
}

async function readAuditRecords(roots: DesktopProjectRoots): Promise<AuditRecord[]> {
  return readJsonlDirectory<AuditRecord>(resolveDesktopObservabilityPath(roots, 'logs', 'audit'));
}

async function readModelInvocationRecords(roots: DesktopProjectRoots): Promise<ModelInvocationRecord[]> {
  return readJsonlDirectory<ModelInvocationRecord>(
    resolveDesktopObservabilityPath(roots, 'model-invocations', 'records'),
  )
    .then((records) => records.filter((record) => record.capture_mode !== 'off'));
}

async function readTraceSpans(roots: DesktopProjectRoots): Promise<StoredSpanRecord[]> {
  const dir = resolveDesktopObservabilityPath(roots, 'traces');
  const files = await listJsonlFiles(dir);
  const spans: StoredSpanRecord[] = [];
  for (const filePath of files) {
    const source = filePath.includes('cognition') ? 'cognition' : filePath.includes('kernel') ? 'kernel' : 'unknown';
    const fileRef = toRepoRelativePath(roots, filePath);
    for (const record of await readJsonlFile<Record<string, unknown>>(filePath)) {
      const traceId = readString(record, 'trace_id');
      const spanId = readString(record, 'span_id');
      const name = readString(record, 'name');
      if (!traceId || !spanId || !name) continue;
      spans.push({
        source,
        name,
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: readNullableString(record, 'parent_span_id'),
        started_at: readString(record, 'started_at'),
        ended_at: readString(record, 'ended_at'),
        duration_ms: readNumber(record, 'duration_ms'),
        status: readString(record, 'status') || 'unknown',
        file_ref: fileRef,
      });
    }
  }
  return spans;
}

async function readDeadLetters(roots: DesktopProjectRoots): Promise<DeadLetterRow[]> {
  const kernelDbPath = resolveDesktopStatePath(roots, 'kernel', 'kernel.db');
  return withKernelDlqDb(kernelDbPath, true, (db) => (
    db.prepare(`
      SELECT id, trace_id, event_type, failure_phase, error_code, owner, source_path,
             redacted_payload_summary, replay_command, diagnostic_hint, status, created_at, resolved_at, resolution
        FROM dead_letters_ts
       ORDER BY created_at DESC
    `).all() as DeadLetterRow[]
  )) ?? [];
}

async function computeObservabilitySourceFingerprint(roots: DesktopProjectRoots): Promise<string> {
  const files = [
    ...(await listJsonlFiles(resolveDesktopObservabilityPath(roots, 'logs', 'events'))),
    ...(await listJsonlFiles(resolveDesktopObservabilityPath(roots, 'logs', 'audit'))),
    ...(await listJsonlFiles(resolveDesktopObservabilityPath(roots, 'model-invocations', 'records'))),
    ...(await listJsonlFiles(resolveDesktopObservabilityPath(roots, 'traces'))),
  ].sort();
  const hash = crypto.createHash('sha1');
  for (const filePath of files) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) continue;
    hash.update(`${toRepoRelativePath(roots, filePath)}:${stat.size}:${stat.mtimeMs};`);
  }
  const kernelDbPath = resolveDesktopStatePath(roots, 'kernel', 'kernel.db');
  if (fileExistsSync(kernelDbPath)) {
    const stat = await fs.stat(kernelDbPath).catch(() => null);
    if (stat) {
      hash.update(`kernel.db:${stat.size}:${stat.mtimeMs};`);
    }
  }
  return hash.digest('hex');
}

async function writeObservabilityIndex(
  roots: DesktopProjectRoots,
  dbPath: string,
  fingerprint: string,
  snapshot: ObservabilitySnapshot,
): Promise<void> {
  const Database = requireBetterSqlite3();
  if (!Database) return;

  const events = snapshot.events.map(toEventSummary);
  const audit = snapshot.audit.map(toAuditSummary);
  const modelInvocations = snapshot.modelInvocations.map(toModelInvocationSummary);
  const dlq = snapshot.dlq.map(toDlqSummary);
  const spans = snapshot.spans.slice();
  const refreshedAt = new Date().toISOString();

  await fs.mkdir(path.dirname(dbPath), { recursive: true }).catch(() => undefined);

  let db: SqliteDatabase | null = null;
  try {
    db = new Database(dbPath);
    db.exec(`
      DROP TABLE IF EXISTS model_invocations;
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        trace_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_action TEXT,
        event_outcome TEXT,
        owner TEXT NOT NULL,
        module TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        phase TEXT,
        error_code TEXT,
        diagnostic_hint TEXT,
        details_ref TEXT,
        artifact_ref TEXT,
        extension_id TEXT,
        provider_id TEXT
      );
      CREATE TABLE IF NOT EXISTS audit (
        trace_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_name TEXT,
        owner TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        outcome TEXT NOT NULL,
        reason TEXT,
        diagnostic_hint TEXT,
        details_ref TEXT,
        artifact_ref TEXT,
        extension_id TEXT,
        provider_id TEXT
      );
      CREATE TABLE IF NOT EXISTS model_invocations (
        trace_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        invocation_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        capture_category TEXT NOT NULL,
        capture_mode TEXT NOT NULL,
        owner TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        outcome TEXT NOT NULL,
        duration_ms REAL,
        prompt_chars INTEGER,
        response_chars INTEGER,
        prompt_hash TEXT,
        response_hash TEXT,
        error_code TEXT,
        error_summary TEXT,
        provider_payload_ref TEXT,
        raw_response_ref TEXT,
        prompt_text_ref TEXT,
        response_text_ref TEXT,
        normalized_text_ref TEXT
      );
      CREATE TABLE IF NOT EXISTS dlq (
        id INTEGER NOT NULL,
        trace_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        owner TEXT NOT NULL,
        failure_phase TEXT NOT NULL,
        error_code TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        resolution TEXT,
        diagnostic_hint TEXT NOT NULL,
        redacted_payload_summary TEXT NOT NULL,
        replay_command TEXT NOT NULL,
        source_path TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS spans (
        trace_id TEXT NOT NULL,
        source TEXT NOT NULL,
        name TEXT NOT NULL,
        span_id TEXT NOT NULL,
        parent_span_id TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        duration_ms REAL NOT NULL,
        status TEXT NOT NULL,
        file_ref TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_trace_timestamp ON events(trace_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_trace_timestamp ON audit(trace_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_model_invocations_trace_timestamp ON model_invocations(trace_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_dlq_trace_created ON dlq(trace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_spans_trace_started ON spans(trace_id, started_at DESC);
    `);

    db.exec('BEGIN');
    db.exec('DELETE FROM metadata');
    db.exec('DELETE FROM events');
    db.exec('DELETE FROM audit');
    db.exec('DELETE FROM model_invocations');
    db.exec('DELETE FROM dlq');
    db.exec('DELETE FROM spans');

    const putMetadata = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
    const putEvent = db.prepare(`
      INSERT INTO events (
        trace_id, timestamp, level, event_type, event_action, event_outcome, owner, module, runtime_id, phase,
        error_code, diagnostic_hint, details_ref, artifact_ref, extension_id, provider_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const putAudit = db.prepare(`
      INSERT INTO audit (
        trace_id, timestamp, action, target_kind, target_name, owner, runtime_id, outcome, reason,
        diagnostic_hint, details_ref, artifact_ref, extension_id, provider_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const putModelInvocation = db.prepare(`
      INSERT INTO model_invocations (
        trace_id, timestamp, invocation_id, purpose, capture_category, capture_mode, owner, runtime_id, provider_id, model_id, outcome,
        duration_ms, prompt_chars, response_chars, prompt_hash, response_hash, error_code, error_summary,
        provider_payload_ref, raw_response_ref, prompt_text_ref, response_text_ref, normalized_text_ref
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const putDlq = db.prepare(`
      INSERT INTO dlq (
        id, trace_id, event_type, owner, failure_phase, error_code, status, created_at, resolved_at, resolution,
        diagnostic_hint, redacted_payload_summary, replay_command, source_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const putSpan = db.prepare(`
      INSERT INTO spans (
        trace_id, source, name, span_id, parent_span_id, started_at, ended_at, duration_ms, status, file_ref
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    putMetadata.run('schema_version', OBSERVABILITY_INDEX_SCHEMA_VERSION);
    putMetadata.run('source_fingerprint', fingerprint);
    putMetadata.run('refreshed_at', refreshedAt);
    putMetadata.run('record_counts', JSON.stringify({
      events: events.length,
      audit: audit.length,
      modelInvocations: modelInvocations.length,
      dlq: dlq.length,
      spans: spans.length,
    }));

    for (const record of events) {
      putEvent.run(
        record.trace_id,
        record.timestamp,
        record.level,
        record.event_type,
        record.event_action ?? null,
        record.event_outcome ?? null,
        record.owner,
        record.module,
        record.runtime_id,
        record.phase ?? null,
        record.error_code ?? null,
        record.diagnostic_hint ?? null,
        record.details_ref ?? null,
        record.artifact_ref ?? null,
        record.extension_id ?? null,
        record.provider_id ?? null,
      );
    }

    for (const record of audit) {
      putAudit.run(
        record.trace_id,
        record.timestamp,
        record.action,
        record.target_kind,
        record.target_name ?? null,
        record.owner,
        record.runtime_id,
        record.outcome,
        record.reason ?? null,
        record.diagnostic_hint ?? null,
        record.details_ref ?? null,
        record.artifact_ref ?? null,
        record.extension_id ?? null,
        record.provider_id ?? null,
      );
    }

    for (const record of modelInvocations) {
      putModelInvocation.run(
        record.trace_id,
        record.timestamp,
        record.invocation_id,
        record.purpose,
        record.capture_category,
        record.capture_mode,
        record.owner,
        record.runtime_id,
        record.provider_id,
        record.model_id,
        record.outcome,
        record.duration_ms ?? null,
        record.prompt_chars ?? null,
        record.response_chars ?? null,
        record.prompt_hash ?? null,
        record.response_hash ?? null,
        record.error_code ?? null,
        record.error_summary ?? null,
        record.provider_payload_ref ?? null,
        record.raw_response_ref ?? null,
        record.prompt_text_ref ?? null,
        record.response_text_ref ?? null,
        record.normalized_text_ref ?? null,
      );
    }

    for (const record of dlq) {
      putDlq.run(
        record.id,
        record.trace_id,
        record.event_type,
        record.owner,
        record.failure_phase,
        record.error_code,
        record.status,
        record.created_at,
        record.resolved_at ?? null,
        record.resolution ?? null,
        record.diagnostic_hint,
        record.redacted_payload_summary,
        record.replay_command,
        record.source_path,
      );
    }

    for (const record of spans) {
      putSpan.run(
        record.trace_id,
        record.source,
        record.name,
        record.span_id,
        record.parent_span_id ?? null,
        record.started_at,
        record.ended_at,
        record.duration_ms,
        record.status,
        record.file_ref,
      );
    }

    db.exec('COMMIT');
  } catch {
    try {
      db?.exec('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
  } finally {
    db?.close();
  }
}

function readIndexMetadata(dbPath: string): {
  schema_version: string;
  source_fingerprint: string;
  refreshed_at: string;
} | null {
  return withIndexDb(dbPath, true, (db) => {
    const rows = db.prepare('SELECT key, value FROM metadata').all() as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((row) => [row.key, row.value]));
    if (!map.has('schema_version') || !map.has('source_fingerprint') || !map.has('refreshed_at')) {
      return null;
    }
    return {
      schema_version: map.get('schema_version') ?? '',
      source_fingerprint: map.get('source_fingerprint') ?? '',
      refreshed_at: map.get('refreshed_at') ?? '',
    };
  });
}

async function resetObservabilityIndex(
  roots: DesktopProjectRoots,
  config: ObservabilityConfig,
): Promise<ObservabilityCleanupBucketResult> {
  const dbPath = resolveControlledDataPath(roots, config.index.db_path, 'observability/index/observability.db');
  if (!fileExistsSync(dbPath)) {
    return {
      id: 'index',
      retention_days: 0,
      deleted_records: 0,
      deleted_files: 0,
      reclaimed_bytes: 0,
      note: 'The index did not exist. It will be rebuilt on demand.',
    };
  }

  const stat = await fs.stat(dbPath).catch(() => null);
  let deletedFiles = 0;
  let reclaimedBytes = stat?.size ?? 0;
  try {
    await fs.rm(dbPath, { force: true });
    deletedFiles = 1;
  } catch {
    reclaimedBytes = 0;
  }

  return {
    id: 'index',
    retention_days: 0,
    deleted_records: 0,
    deleted_files: deletedFiles,
    reclaimed_bytes: reclaimedBytes,
    note: 'The SQLite index file is reset after cleanup and will be rebuilt on the next diagnostics query.',
  };
}

async function pruneJsonlDirectory(
  directory: string,
  timestampKeys: string[],
  retentionDays: number,
  id: ObservabilityCleanupBucketResult['id'],
  note: string,
): Promise<ObservabilityCleanupBucketResult> {
  const files = await listJsonlFiles(directory);
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deletedRecords = 0;
  let deletedFiles = 0;
  let reclaimedBytes = 0;

  for (const filePath of files) {
    const source = await fs.readFile(filePath, 'utf8').catch(() => '');
    if (!source) continue;
    const originalBytes = Buffer.byteLength(source, 'utf8');
    const keptLines: string[] = [];
    let removedFromFile = 0;

    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = safeJsonParse<Record<string, unknown>>(trimmed);
      if (!parsed) {
        keptLines.push(trimmed);
        continue;
      }
      const timestamp = readFirstString(parsed, timestampKeys);
      if (!timestamp) {
        keptLines.push(trimmed);
        continue;
      }
      const timeValue = Date.parse(timestamp);
      if (!Number.isFinite(timeValue) || timeValue >= cutoffMs) {
        keptLines.push(trimmed);
        continue;
      }
      removedFromFile += 1;
    }

    if (removedFromFile === 0) continue;
    deletedRecords += removedFromFile;

    if (keptLines.length === 0) {
      await fs.rm(filePath, { force: true }).catch(() => undefined);
      deletedFiles += 1;
      reclaimedBytes += originalBytes;
      continue;
    }

    const nextSource = `${keptLines.join('\n')}\n`;
    await fs.writeFile(filePath, nextSource, 'utf8').catch(() => undefined);
    reclaimedBytes += Math.max(originalBytes - Buffer.byteLength(nextSource, 'utf8'), 0);
  }

  return {
    id,
    retention_days: retentionDays,
    deleted_records: deletedRecords,
    deleted_files: deletedFiles,
    reclaimed_bytes: reclaimedBytes,
    note,
  };
}

async function pruneFilesByMtime(
  directory: string,
  retentionDays: number,
  id: ObservabilityCleanupBucketResult['id'],
  note: string,
): Promise<ObservabilityCleanupBucketResult> {
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const targets = await listFilesRecursive(directory);
  let deletedFiles = 0;
  let reclaimedBytes = 0;

  for (const filePath of targets) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || stat.mtimeMs >= cutoffMs) continue;
    await fs.rm(filePath, { force: true }).catch(() => undefined);
    deletedFiles += 1;
    reclaimedBytes += stat.size;
  }

  return {
    id,
    retention_days: retentionDays,
    deleted_records: 0,
    deleted_files: deletedFiles,
    reclaimed_bytes: reclaimedBytes,
    note,
  };
}

function pruneDeadLetters(
  roots: DesktopProjectRoots,
  retentionDays: number,
): ObservabilityCleanupBucketResult {
  const kernelDbPath = resolveDesktopStatePath(roots, 'kernel', 'kernel.db');
  const cutoffIso = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const deleted = withKernelDlqDb(kernelDbPath, false, (db) => {
    const before = db.prepare(`
      SELECT COUNT(*) AS count
        FROM dead_letters_ts
       WHERE status IN ('resolved', 'replayed')
         AND COALESCE(NULLIF(resolved_at, ''), created_at) < ?
    `).get(cutoffIso) as { count?: number } | null;
    db.prepare(`
      DELETE FROM dead_letters_ts
       WHERE status IN ('resolved', 'replayed')
         AND COALESCE(NULLIF(resolved_at, ''), created_at) < ?
    `).run(cutoffIso);
    return Number(before?.count ?? 0);
  }) ?? 0;

  return {
    id: 'dlq',
    retention_days: retentionDays,
    deleted_records: deleted,
    deleted_files: 0,
    reclaimed_bytes: 0,
    note: 'Only resolved or replayed DLQ rows are eligible for cleanup.',
  };
}

function buildRuntimeProjectionSummary(
  context: ObservabilityQueryContext,
  projection: ObservabilityTraceProjection,
): RuntimeProjectionSummary {
  const relatedExtensions = new Set(projection.related_extensions);
  const runtimes = (context.runtimeReadiness?.runtimes ?? []).map((runtime) => ({
    runtime_id: runtime.runtime_id,
    owner: runtime.owner,
    state: runtime.state,
    phase: runtime.phase,
    summary: runtime.summary,
    blocking: runtime.blocking,
  }));
  const extensions = (context.extensionRuntimeProjections ?? [])
    .filter((item) => relatedExtensions.size === 0 || relatedExtensions.has(item.extension_id))
    .map((item) => ({
      extension_id: item.extension_id,
      display_name: item.display_name ?? item.extension_id,
      operational_state: item.lifecycle,
      diagnostic_entries: item.diagnostics.entries.length,
      log_locations: [...(item.diagnostics.log_locations ?? [])],
    }));

  return {
    generated_at: new Date().toISOString(),
    runtimes,
    extensions,
  };
}

async function exportProcessLogSnippets(
  roots: DesktopProjectRoots,
  refs: ObservabilityProcessLogRef[],
  outputDir: string,
  tailBytes: number,
): Promise<{ count: number }> {
  if (refs.length === 0) return { count: 0 };
  await fs.mkdir(outputDir, { recursive: true });

  let count = 0;
  for (const ref of refs) {
    const actualPath = resolveDesktopProjectPath(roots, ref.path);
    const snippet = await readFileTail(actualPath, tailBytes);
    if (!snippet) continue;
    const fileName = `${sanitizeForFileName(ref.label, 48)}-${sanitizeForFileName(ref.id, 48)}.log.txt`;
    const target = path.join(outputDir, fileName);
    await fs.writeFile(target, snippet, 'utf8');
    count += 1;
  }

  return { count };
}

async function exportModelInvocationCaptures(
  roots: DesktopProjectRoots,
  modelInvocations: ObservabilityModelInvocationSummary[],
  outputDir: string,
): Promise<number> {
  const refs = new Set<string>();
  for (const record of modelInvocations) {
    for (const candidate of [
      record.provider_payload_ref,
      record.raw_response_ref,
      record.prompt_text_ref,
      record.response_text_ref,
      record.normalized_text_ref,
    ]) {
      if (candidate) refs.add(candidate);
    }
  }
  if (refs.size === 0) return 0;

  await fs.mkdir(outputDir, { recursive: true });
  let copied = 0;
  for (const ref of refs) {
    const sourcePath = resolveDesktopObservabilityPath(roots, 'model-invocations', ref);
    if (!fileExistsSync(sourcePath)) continue;
    const targetPath = joinSafeSubpath(outputDir, ref.split('/'));
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath).catch(() => undefined);
    copied += 1;
  }
  return copied;
}

async function writeBundleSection(
  bundleRoot: string,
  fileName: string,
  payload: unknown,
  sections: ObservabilityBundleManifestSection[],
  id: string,
  recordCount: number,
): Promise<void> {
  const target = path.join(bundleRoot, fileName);
  await fs.writeFile(target, JSON.stringify(payload, null, 2), 'utf8');
  sections.push({
    id,
    path: fileName.replace(/\\/g, '/'),
    record_count: recordCount,
  });
}

async function readJsonlDirectory<T>(directory: string): Promise<T[]> {
  const files = await listJsonlFiles(directory);
  const records = await Promise.all(files.map((filePath) => readJsonlFile<T>(filePath)));
  return records.flat();
}

async function listJsonlFiles(directory: string): Promise<string[]> {
  return (await listFilesRecursive(directory)).filter((filePath) => filePath.endsWith('.jsonl')).sort();
}

async function listFilesRecursive(directory: string): Promise<string[]> {
  if (!fileExistsSync(directory)) return [];
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listFilesRecursive(target);
    }
    if (entry.isFile()) {
      return [target];
    }
    return [];
  }));
  return nested.flat().sort();
}

async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  const source = await fs.readFile(filePath, 'utf8').catch(() => '');
  if (!source) return [];
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeJsonParse<T>(line))
    .filter((record): record is T => record !== null);
}

async function readFileTail(filePath: string, tailBytes: number): Promise<string> {
  try {
    const buffer = await fs.readFile(filePath);
    if (buffer.length <= tailBytes) {
      return buffer.toString('utf8');
    }
    return buffer.subarray(buffer.length - tailBytes).toString('utf8');
  } catch {
    return '';
  }
}

async function loadObservabilityConfig(roots: DesktopProjectRoots): Promise<ObservabilityConfig> {
  const filePath = resolveDesktopConfigChildPath(roots, 'system', 'observability.yaml');
  const source = await fs.readFile(filePath, 'utf8').catch(() => '');
  if (!source) return cloneObservabilityConfig(DEFAULT_OBSERVABILITY_CONFIG);

  try {
    const parsed = YAML.parse(source) as Partial<ObservabilityConfig> | null;
    return {
      ...cloneObservabilityConfig(DEFAULT_OBSERVABILITY_CONFIG),
      ...(parsed ?? {}),
      rotation: {
        ...DEFAULT_OBSERVABILITY_CONFIG.rotation,
        ...(parsed?.rotation ?? {}),
      },
      model_invocations: {
        ...DEFAULT_OBSERVABILITY_CONFIG.model_invocations,
        ...(parsed?.model_invocations ?? {}),
      },
      retention: {
        ...DEFAULT_OBSERVABILITY_CONFIG.retention,
        ...(parsed?.retention ?? {}),
      },
      index: {
        ...DEFAULT_OBSERVABILITY_CONFIG.index,
        ...(parsed?.index ?? {}),
      },
      bundles: {
        ...DEFAULT_OBSERVABILITY_CONFIG.bundles,
        ...(parsed?.bundles ?? {}),
      },
    };
  } catch {
    return cloneObservabilityConfig(DEFAULT_OBSERVABILITY_CONFIG);
  }
}

function buildRetentionPolicy(
  roots: DesktopProjectRoots,
  config: ObservabilityConfig,
): ObservabilityRetentionPolicy {
  const bundleDir = resolveControlledDataPath(roots, config.bundles.export_dir, 'observability/bundles');
  return {
    events_days: config.retention.events_days,
    traces_days: config.retention.traces_days,
    metrics_days: config.retention.metrics_days,
    audit_days: config.retention.audit_days,
    model_invocation_days: Math.max(config.retention.model_invocation_days, config.model_invocations.full_retention_days),
    model_invocation_capture_days: config.model_invocations.full_retention_days,
    application_log_days: config.retention.application_log_days,
    dlq_days: config.retention.dlq_days,
    bundles_days: config.retention.bundles_days,
    bundle_export_dir: toRepoRelativePath(roots, bundleDir),
    include_model_invocation_captures: config.bundles.include_model_invocation_captures,
    process_tail_bytes: config.bundles.process_tail_bytes,
  };
}

function buildBundleTraceSummary(projection: ObservabilityTraceProjection): ObservabilityBundleManifest['trace_summary'] {
  return {
    events: projection.events.length,
    audit: projection.audit.length,
    modelInvocations: projection.modelInvocations.length,
    dlq: projection.dlq.length,
    spans: projection.spans.length,
    process_logs: projection.process_log_refs.length,
    related_runtime_ids: projection.related_runtime_ids,
    related_extensions: projection.related_extensions,
    related_providers: projection.related_providers,
  };
}

function buildProjectionNotes(storage: ObservabilityStorageStatus): string[] {
  if (storage.mode === 'sqlite_index') {
    return [
      'Renderer consumes IPC projections only; Electron main owns observability.db reads.',
      'trace_id stays query-only and does not become a metric label.',
      'SQLite index mirrors JSONL and DLQ summaries; JSONL remains the source of truth until the scan fallback is deleted.',
    ];
  }
  return [
    'Desktop main is still scanning JSONL and Kernel DLQ directly.',
    'Renderer consumes IPC projections only and never reads raw observability files.',
    'trace_id stays query-only and does not become a metric label.',
  ];
}

function buildJsonlStorageStatus(
  roots: DesktopProjectRoots,
  config: ObservabilityConfig,
): ObservabilityStorageStatus {
  const indexPath = resolveControlledDataPath(roots, config.index.db_path, 'observability/index/observability.db');
  return {
    mode: 'jsonl_scan',
    owner: 'desktop-main',
    index_path: toRepoRelativePath(roots, indexPath),
    pending_index_path: toRepoRelativePath(roots, indexPath),
    recovery_note: INDEX_RECOVERY_NOTE,
  };
}

function buildSqliteStorageStatus(
  roots: DesktopProjectRoots,
  dbPath: string,
  refreshedAt: string,
  sourceFingerprint: string,
): ObservabilityStorageStatus {
  return {
    mode: 'sqlite_index',
    owner: 'desktop-main',
    index_path: toRepoRelativePath(roots, dbPath),
    pending_index_path: null,
    refreshed_at: refreshedAt,
    source_fingerprint: sourceFingerprint,
    recovery_note: INDEX_RECOVERY_NOTE,
  };
}

function toEventSummary(record: ObservabilityEvent): ObservabilityEventSummary {
  return {
    timestamp: record.timestamp,
    level: record.level,
    event_type: record.event_type,
    event_action: record.event_action ?? null,
    event_outcome: record.event_outcome ?? null,
    owner: record.owner,
    module: record.module,
    runtime_id: record.runtime_id,
    phase: record.phase ?? null,
    trace_id: record.trace_id,
    error_code: record.error_code ?? null,
    diagnostic_hint: record.diagnostic_hint ?? null,
    details_ref: record.details_ref ?? null,
    artifact_ref: record.artifact_ref ?? null,
    extension_id: record.extension_id ?? null,
    provider_id: record.provider_id ?? null,
  };
}

function toAuditSummary(record: AuditRecord): ObservabilityAuditSummary {
  return {
    timestamp: record.timestamp,
    action: record.action,
    target_kind: record.target_kind,
    target_name: record.target_name ?? null,
    owner: record.owner,
    runtime_id: record.runtime_id,
    trace_id: record.trace_id,
    outcome: record.outcome,
    reason: record.reason ?? null,
    diagnostic_hint: record.diagnostic_hint ?? null,
    details_ref: record.details_ref ?? null,
    artifact_ref: record.artifact_ref ?? null,
    extension_id: record.extension_id ?? null,
    provider_id: record.provider_id ?? null,
  };
}

function toModelInvocationSummary(record: ModelInvocationRecord): ObservabilityModelInvocationSummary {
  return {
    timestamp: record.timestamp,
    invocation_id: record.invocation_id,
    trace_id: record.trace_id,
    purpose: record.purpose,
    capture_category: record.capture_category ?? 'other',
    capture_mode: record.capture_mode,
    owner: record.owner,
    runtime_id: record.runtime_id,
    provider_id: record.provider_id,
    model_id: record.model_id,
    outcome: record.outcome,
    duration_ms: record.duration_ms ?? null,
    prompt_chars: record.prompt_chars ?? null,
    response_chars: record.response_chars ?? null,
    prompt_hash: record.prompt_hash ?? null,
    response_hash: record.response_hash ?? null,
    error_code: record.error_code ?? null,
    error_summary: record.error_summary ?? null,
    provider_payload_ref: record.provider_payload_ref ?? null,
    raw_response_ref: record.raw_response_ref ?? null,
    prompt_text_ref: record.prompt_text_ref ?? null,
    response_text_ref: record.response_text_ref ?? null,
    normalized_text_ref: record.normalized_text_ref ?? null,
  };
}

function toDlqSummary(record: DeadLetterRow): ObservabilityDlqSummary {
  return {
    id: record.id,
    trace_id: record.trace_id,
    event_type: record.event_type,
    owner: record.owner,
    failure_phase: record.failure_phase,
    error_code: record.error_code,
    status: record.status,
    created_at: record.created_at,
    resolved_at: record.resolved_at || null,
    resolution: record.resolution || null,
    diagnostic_hint: record.diagnostic_hint,
    redacted_payload_summary: record.redacted_payload_summary,
    replay_command: record.replay_command,
    source_path: record.source_path,
  };
}

function isErrorEventSummary(record: ObservabilityEventSummary): boolean {
  return record.level === 'error'
    || record.event_outcome === 'failed'
    || record.event_outcome === 'partial'
    || record.event_outcome === 'timeout'
    || record.event_outcome === 'policy_denied';
}

function isErrorAuditSummary(record: ObservabilityAuditSummary): boolean {
  return record.outcome === 'failed'
    || record.outcome === 'partial'
    || record.outcome === 'timeout'
    || record.outcome === 'policy_denied'
    || record.outcome === 'cancelled';
}

function collectProcessRefsFromEventSummaries(
  roots: DesktopProjectRoots,
  records: ObservabilityEventSummary[],
): ObservabilityProcessLogRef[] {
  const refs = records.flatMap((record) => ([
    createProcessLogRefFromProjectPath(roots, record.details_ref, 'details_ref', record.owner, record.event_type),
    createProcessLogRefFromProjectPath(roots, record.artifact_ref, 'artifact_ref', record.owner, record.event_type),
  ]).filter((item): item is ObservabilityProcessLogRef => Boolean(item)));

  const needsCognition = records.some((record) => record.owner === 'cognition' || record.provider_id?.includes('llm'));
  const needsAudioTts = records.some((record) => record.runtime_id.includes('audio.tts') || record.details_ref?.includes('audio-tts.console.log'));
  const needsAudioAsr = records.some((record) => record.runtime_id.includes('audio.asr') || record.details_ref?.includes('audio-asr.console.log'));
  const needsAvatar = records.some((record) => record.runtime_id.includes('avatar') || record.details_ref?.includes('avatar-host.console.log'));

  return [
    ...refs,
    ...(needsCognition ? [buildKnownProcessRef(roots, 'cognition')] : []),
    ...(needsAudioTts ? [buildKnownProcessRef(roots, 'audio-tts')] : []),
    ...(needsAudioAsr ? [buildKnownProcessRef(roots, 'audio-asr')] : []),
    ...(needsAvatar ? [buildKnownProcessRef(roots, 'avatar')] : []),
  ];
}

function collectProcessRefsFromAuditSummaries(
  roots: DesktopProjectRoots,
  records: ObservabilityAuditSummary[],
): ObservabilityProcessLogRef[] {
  return records.flatMap((record) => ([
    createProcessLogRefFromProjectPath(roots, record.details_ref, 'details_ref', record.owner, record.action),
    createProcessLogRefFromProjectPath(roots, record.artifact_ref, 'artifact_ref', record.owner, record.action),
  ]).filter((item): item is ObservabilityProcessLogRef => Boolean(item)));
}

function collectProcessRefsFromModelInvocations(
  roots: DesktopProjectRoots,
  records: ObservabilityModelInvocationSummary[],
): ObservabilityProcessLogRef[] {
  if (records.length === 0) return [];
  return [buildKnownProcessRef(roots, 'cognition')];
}

function collectProcessRefsFromDlqSummaries(
  roots: DesktopProjectRoots,
  records: ObservabilityDlqSummary[],
): ObservabilityProcessLogRef[] {
  return records.flatMap((record) => ([
    createProcessLogRefFromProjectPath(roots, record.source_path, 'details_ref', record.owner, record.event_type),
    inferKnownProcessRefFromSourcePath(roots, record.source_path),
  ]).filter((item): item is ObservabilityProcessLogRef => Boolean(item)));
}

function collectProjectionProcessRefs(
  roots: DesktopProjectRoots,
  projections: ExtensionRuntimeProjection[],
  extensionIds: Set<string>,
): ObservabilityProcessLogRef[] {
  if (projections.length === 0 || extensionIds.size === 0) return [];
  const refs: ObservabilityProcessLogRef[] = [];

  for (const projection of projections) {
    if (!extensionIds.has(projection.extension_id)) continue;
    for (const location of projection.diagnostics.log_locations ?? []) {
      const ref = createProcessLogRefFromProjectPath(
        roots,
        location,
        'extension_projection',
        `extension:${projection.extension_id}`,
        projection.display_name || projection.extension_id,
      );
      if (ref) refs.push(ref);
    }
    for (const entry of projection.diagnostics.entries ?? []) {
      for (const location of entry.log_locations ?? []) {
        const ref = createProcessLogRefFromProjectPath(
          roots,
          location,
          'extension_projection',
          `extension:${projection.extension_id}`,
          entry.summary,
        );
        if (ref) refs.push(ref);
      }
    }
    for (const node of projection.capability_graph.nodes ?? []) {
      const logDir = typeof node.metadata.log_dir === 'string' ? node.metadata.log_dir : '';
      const ref = createProcessLogRefFromProjectPath(
        roots,
        logDir,
        'extension_projection',
        `extension:${projection.extension_id}`,
        node.title,
      );
      if (ref) refs.push(ref);
    }
  }

  return refs;
}

function collectMetricRefs(roots: DesktopProjectRoots): ObservabilityMetricRef[] {
  const candidates = [
    { id: 'kernel-metrics', source: 'kernel' as const, path: 'data/observability/metrics/kernel.jsonl' },
    { id: 'cognition-metrics', source: 'cognition' as const, path: 'data/observability/metrics/cognition.jsonl' },
  ];
  return candidates
    .filter((item) => fileExistsSync(resolveDesktopProjectPath(roots, item.path)))
    .map((item) => ({
      ...item,
      note: 'trace_id remains a query key and is not emitted as a metric label.',
    }));
}

function buildKnownProcessRef(
  roots: DesktopProjectRoots,
  id: 'cognition' | 'audio-tts' | 'audio-asr' | 'avatar',
): ObservabilityProcessLogRef {
  const actualPath = id === 'cognition'
    ? 'data/observability/logs/application/cognition.console.log'
    : id === 'audio-tts'
      ? 'data/observability/logs/application/audio-tts.console.log'
      : id === 'audio-asr'
        ? 'data/observability/logs/application/audio-asr.console.log'
        : 'data/observability/logs/application/avatar-host.console.log';
  const label = id === 'cognition'
    ? 'Cognition process log'
    : id === 'audio-tts'
      ? 'Audio TTS process log'
      : id === 'audio-asr'
        ? 'Audio ASR process log'
        : 'Avatar process log';

  return buildProcessLogRef(
    roots,
    id,
    id.startsWith('audio') ? 'audio' : id === 'avatar' ? 'avatar' : 'cognition',
    label,
    'known_process',
    actualPath,
  );
}

function inferKnownProcessRefFromSourcePath(
  roots: DesktopProjectRoots,
  sourcePath: string,
): ObservabilityProcessLogRef | null {
  const normalized = sourcePath.replace(/\\/g, '/');
  if (normalized.includes('cognition.console.log')) return buildKnownProcessRef(roots, 'cognition');
  if (normalized.includes('audio-tts.console.log')) return buildKnownProcessRef(roots, 'audio-tts');
  if (normalized.includes('audio-asr.console.log')) return buildKnownProcessRef(roots, 'audio-asr');
  if (normalized.includes('avatar-host.console.log')) return buildKnownProcessRef(roots, 'avatar');
  return null;
}

function createProcessLogRefFromProjectPath(
  roots: DesktopProjectRoots,
  projectPath: string | null | undefined,
  source: ObservabilityProcessLogRef['source'],
  owner: string,
  labelHint: string,
): ObservabilityProcessLogRef | null {
  if (!projectPath || typeof projectPath !== 'string') return null;
  const normalized = projectPath.replace(/\\/g, '/');
  if (!normalized.includes('data/observability/logs/')) return null;
  return buildProcessLogRef(
    roots,
    `${owner}:${labelHint}:${normalized}`,
    owner,
    labelHint,
    source,
    normalizeProjectRelativePath(projectPath),
  );
}

function buildProcessLogRef(
  roots: DesktopProjectRoots,
  id: string,
  owner: string,
  label: string,
  source: ObservabilityProcessLogRef['source'],
  actualProjectPath: string,
): ObservabilityProcessLogRef {
  const actualPath = normalizeProjectRelativePath(actualProjectPath);
  return {
    id,
    owner,
    label,
    source,
    path: actualPath,
    exists: fileExistsSync(resolveDesktopProjectPath(roots, actualPath)),
  };
}

function normalizeProjectRelativePath(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, '/');
  if (normalized.startsWith('data/')) return normalized;
  const observabilityIndex = normalized.indexOf('data/observability/');
  if (observabilityIndex >= 0) {
    return normalized.slice(observabilityIndex);
  }
  return normalized;
}

function resolveControlledDataPath(
  roots: DesktopProjectRoots,
  configuredPath: string,
  fallbackRelativePath: string,
): string {
  const raw = (configuredPath || '').trim();
  const normalized = raw.replace(/\\/g, '/').replace(/^data\//, '');
  const fallback = path.resolve(roots.dataRoot, fallbackRelativePath);
  const candidate = raw
    ? (path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(roots.dataRoot, normalized))
    : fallback;
  const relative = path.relative(roots.dataRoot, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return fallback;
  }
  return candidate;
}

function toRepoRelativePath(roots: DesktopProjectRoots, filePath: string): string {
  const relativeToRepo = path.relative(roots.repoRoot, filePath).replace(/\\/g, '/');
  if (!relativeToRepo.startsWith('..') && !path.isAbsolute(relativeToRepo)) {
    return relativeToRepo;
  }
  const relativeToData = path.relative(roots.dataRoot, filePath).replace(/\\/g, '/');
  if (!relativeToData.startsWith('..') && !path.isAbsolute(relativeToData)) {
    return `data/${relativeToData}`;
  }
  return filePath.replace(/\\/g, '/');
}

function compareTimestampDesc(
  left: { timestamp?: string; created_at?: string },
  right: { timestamp?: string; created_at?: string },
): number {
  return (Date.parse(right.timestamp ?? right.created_at ?? '') || 0)
    - (Date.parse(left.timestamp ?? left.created_at ?? '') || 0);
}

function compareCreatedAtDesc(
  left: { created_at: string },
  right: { created_at: string },
): number {
  return (Date.parse(right.created_at) || 0) - (Date.parse(left.created_at) || 0);
}

function compareSpanStartedAtDesc(left: StoredSpanRecord, right: StoredSpanRecord): number {
  return (Date.parse(right.started_at) || 0) - (Date.parse(left.started_at) || 0);
}

function collectDistinct(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function dedupeProcessLogRefs(items: ObservabilityProcessLogRef[]): ObservabilityProcessLogRef[] {
  const byKey = new Map<string, ObservabilityProcessLogRef>();
  for (const item of items) {
    const key = item.path;
    if (!byKey.has(key)) {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function readNullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readFirstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return '';
}

function safeJsonParse<T>(line: string): T | null {
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

function sanitizeForFileName(value: string, maxLength = 64): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (sanitized || 'item').slice(0, maxLength);
}

function cloneObservabilityConfig(config: ObservabilityConfig): ObservabilityConfig {
  return JSON.parse(JSON.stringify(config)) as ObservabilityConfig;
}

function joinSafeSubpath(baseDir: string, segments: string[]): string {
  const target = path.resolve(baseDir, ...segments);
  const relative = path.relative(baseDir, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Unsafe bundle subpath');
  }
  return target;
}

function withIndexDb<T>(
  dbPath: string,
  readonly: boolean,
  fn: (db: SqliteDatabase) => T,
): T | null {
  const Database = requireBetterSqlite3();
  if (!Database || !fileExistsSync(dbPath)) return null;
  let db: SqliteDatabase | null = null;
  try {
    db = new Database(dbPath, readonly ? { readonly: true, fileMustExist: true } : undefined);
    return fn(db);
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function withKernelDlqDb<T>(
  dbPath: string,
  readonly: boolean,
  fn: (db: SqliteDatabase) => T,
): T | null {
  const Database = requireBetterSqlite3();
  if (!Database || !fileExistsSync(dbPath)) return null;
  let db: SqliteDatabase | null = null;
  try {
    db = new Database(dbPath, readonly ? { readonly: true, fileMustExist: true } : undefined);
    return fn(db);
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function requireBetterSqlite3(): SqliteDatabaseConstructor | null {
  try {
    return require('better-sqlite3') as SqliteDatabaseConstructor;
  } catch {
    return null;
  }
}
