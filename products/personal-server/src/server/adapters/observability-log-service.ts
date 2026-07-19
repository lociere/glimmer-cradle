import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AuditRecord, ObservabilityEvent } from '@glimmer-cradle/protocol';

export type ObservabilityLogSource = 'event' | 'audit' | 'application';
export type ObservabilityLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ObservabilityLogQuery {
  readonly level?: string;
  readonly module?: string;
  readonly trace_id?: string;
  readonly limit?: number;
}

export interface ObservabilityLogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly source: ObservabilityLogSource;
  readonly level: ObservabilityLogLevel;
  readonly module: string;
  readonly owner: string;
  readonly runtime_id: string;
  readonly trace_id: string;
  readonly event_type: string;
  readonly message: string;
  readonly summary?: string;
  readonly raw: string;
}

export interface ObservabilityLogCursor {
  readonly event: number;
  readonly audit: number;
  readonly application: number;
}

interface LogSourceDefinition {
  readonly id: ObservabilityLogSource;
  readonly filePath: string;
}

const MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_LIMIT = 200;

export class ObservabilityLogService {
  private readonly sources: readonly LogSourceDefinition[];

  public constructor(private readonly observabilityRoot: string) {
    this.sources = [
      { id: 'event', filePath: path.join(observabilityRoot, 'logs', 'events', 'kernel.jsonl') },
      { id: 'audit', filePath: path.join(observabilityRoot, 'logs', 'audit', 'kernel.jsonl') },
      { id: 'application', filePath: path.join(observabilityRoot, 'logs', 'application', 'kernel.jsonl') },
    ];
  }

  public createCursor(): ObservabilityLogCursor {
    return { event: 0, audit: 0, application: 0 };
  }

  public async listRecentEntries(query: ObservabilityLogQuery = {}): Promise<ObservabilityLogEntry[]> {
    const entries = await Promise.all(this.sources.map(async (source) => (
      this.readRecentSourceEntries(source, query)
    )));
    return entries.flat().sort(compareTimestampDesc).slice(0, clampLimit(query.limit));
  }

  public async readIncrementalEntries(
    cursor: ObservabilityLogCursor,
    query: ObservabilityLogQuery = {},
  ): Promise<{ cursor: ObservabilityLogCursor; entries: ObservabilityLogEntry[] }> {
    const nextCursor: Record<ObservabilityLogSource, number> = { ...cursor };
    const entries: ObservabilityLogEntry[] = [];

    for (const source of this.sources) {
      const current = await this.readSourceIncrement(source, nextCursor[source.id], query);
      nextCursor[source.id] = current.nextOffset;
      entries.push(...current.entries);
    }

    return {
      cursor: {
        event: nextCursor.event,
        audit: nextCursor.audit,
        application: nextCursor.application,
      },
      entries: entries.sort(compareTimestampAsc),
    };
  }

  private async readRecentSourceEntries(
    source: LogSourceDefinition,
    query: ObservabilityLogQuery,
  ): Promise<ObservabilityLogEntry[]> {
    const lines = await readTailLines(source.filePath, MAX_FILE_BYTES);
    return lines
      .map((line, index) => normalizeLogEntry(source.id, line, index))
      .filter((entry): entry is ObservabilityLogEntry => Boolean(entry))
      .filter((entry) => matchesLogQuery(entry, query));
  }

  private async readSourceIncrement(
    source: LogSourceDefinition,
    previousOffset: number,
    query: ObservabilityLogQuery,
  ): Promise<{ nextOffset: number; entries: ObservabilityLogEntry[] }> {
    const fileStat = await stat(source.filePath).catch(() => null);
    if (!fileStat || fileStat.size <= 0) {
      return { nextOffset: 0, entries: [] };
    }

    const startOffset = fileStat.size < previousOffset ? 0 : previousOffset;
    if (fileStat.size === startOffset) {
      return { nextOffset: fileStat.size, entries: [] };
    }

    const handle = await open(source.filePath, 'r');
    try {
      const readLength = fileStat.size - startOffset;
      const buffer = Buffer.alloc(readLength);
      await handle.read(buffer, 0, readLength, startOffset);
      const lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
      return {
        nextOffset: fileStat.size,
        entries: lines
          .map((line, index) => normalizeLogEntry(source.id, line, index, startOffset))
          .filter((entry): entry is ObservabilityLogEntry => Boolean(entry))
          .filter((entry) => matchesLogQuery(entry, query)),
      };
    } finally {
      await handle.close();
    }
  }
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Number(limit), 500));
}

async function readTailLines(filePath: string, maxBytes: number): Promise<string[]> {
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat || fileStat.size <= 0) return [];

  const start = Math.max(0, fileStat.size - maxBytes);
  const buffer = await readFile(filePath);
  const text = buffer.slice(start).toString('utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  return start > 0 ? lines.slice(1) : lines;
}

function normalizeLogEntry(
  source: ObservabilityLogSource,
  rawLine: string,
  lineIndex: number,
  offsetSeed = 0,
): ObservabilityLogEntry | null {
  const payload = safeJsonParse(rawLine);
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;

  if (source === 'event') {
    const event = record as unknown as ObservabilityEvent;
    if (!event.timestamp || !event.event_type) return null;
    return {
      id: `${source}:${event.timestamp}:${offsetSeed + lineIndex}`,
      timestamp: event.timestamp,
      source,
      level: normalizeLogLevel(event.level),
      module: event.module || 'kernel',
      owner: event.owner || 'kernel',
      runtime_id: event.runtime_id || 'kernel',
      trace_id: event.trace_id || '',
      event_type: event.event_type,
      message: event.event_action || event.diagnostic_hint || event.event_type,
      summary: event.event_outcome || event.error_code || undefined,
      raw: rawLine,
    };
  }

  if (source === 'audit') {
    const audit = record as unknown as AuditRecord;
    if (!audit.timestamp || !audit.action) return null;
    return {
      id: `${source}:${audit.timestamp}:${offsetSeed + lineIndex}`,
      timestamp: audit.timestamp,
      source,
      level: normalizeAuditLevel(audit.outcome),
      module: audit.module || 'audit',
      owner: audit.owner || 'kernel',
      runtime_id: audit.runtime_id || 'kernel',
      trace_id: audit.trace_id || '',
      event_type: audit.action,
      message: `${audit.action} ${audit.target_kind}${audit.target_name ? `:${audit.target_name}` : ''}`.trim(),
      summary: audit.reason || audit.outcome,
      raw: rawLine,
    };
  }

  const timestamp = stringValue(record.timestamp);
  const level = normalizeLogLevel(stringValue(record.level));
  const module = stringValue(record.module) || 'kernel';
  const message = stringValue(record.message) || module;
  if (!timestamp) return null;
  return {
    id: `${source}:${timestamp}:${offsetSeed + lineIndex}`,
    timestamp,
    source,
    level,
    module,
    owner: stringValue(record.owner) || 'kernel',
    runtime_id: stringValue(record.runtime_id) || 'kernel',
    trace_id: stringValue(record.trace_id),
    event_type: stringValue(record.event_type) || module,
    message,
    summary: stringValue(record.error_code) || undefined,
    raw: rawLine,
  };
}

function matchesLogQuery(entry: ObservabilityLogEntry, query: ObservabilityLogQuery): boolean {
  const level = normalizeLevelQuery(query.level);
  if (level && entry.level !== level) return false;

  const moduleQuery = query.module?.trim().toLowerCase();
  if (moduleQuery && !entry.module.toLowerCase().includes(moduleQuery)) return false;

  const traceQuery = query.trace_id?.trim().toLowerCase();
  if (traceQuery && !entry.trace_id.toLowerCase().includes(traceQuery)) return false;

  return true;
}

function normalizeLevelQuery(value: string | undefined): ObservabilityLogLevel | '' {
  const normalized = value?.trim().toLowerCase() || '';
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
    return normalized;
  }
  return '';
}

function normalizeLogLevel(value: unknown): ObservabilityLogLevel {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
    return normalized;
  }
  if (normalized === 'warning') return 'warn';
  return 'info';
}

function normalizeAuditLevel(outcome: string | null | undefined): ObservabilityLogLevel {
  switch ((outcome || '').toLowerCase()) {
    case 'failed':
    case 'timeout':
      return 'error';
    case 'partial':
    case 'policy_denied':
    case 'cancelled':
      return 'warn';
    default:
      return 'info';
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function compareTimestampDesc(left: ObservabilityLogEntry, right: ObservabilityLogEntry): number {
  return (Date.parse(right.timestamp) || 0) - (Date.parse(left.timestamp) || 0);
}

function compareTimestampAsc(left: ObservabilityLogEntry, right: ObservabilityLogEntry): number {
  return (Date.parse(left.timestamp) || 0) - (Date.parse(right.timestamp) || 0);
}
