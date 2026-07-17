import { getLogger } from '../logger/logger';
import { DBManager } from '../storage/db-manager';
import { OBSERVABILITY_EVENT_TYPES, recordObservabilityEvent } from '../observability/plane';

const logger = getLogger('dlq');

export interface DeadLetterRecord {
  id: number;
  trace_id: string;
  event_type: string;
  failure_phase: string;
  error_code: string;
  owner: string;
  source_path: string;
  payload: string;
  redacted_payload_summary: string;
  error_message: string;
  stack_trace: string;
  retry_policy: string;
  replay_command: string;
  diagnostic_hint: string;
  status: string;
  created_at: string;
  resolved_at: string;
  resolution: string;
  replayed: boolean;
}

export interface DeadLetterEnqueueOptions {
  failurePhase?: string;
  errorCode?: string;
  owner?: string;
  sourcePath?: string;
  redactedPayloadSummary?: string;
  retryPolicy?: string;
  replayCommand?: string;
  diagnosticHint?: string;
}

export class DeadLetterQueue {
  private static _instance: DeadLetterQueue | null = null;
  private _initialized = false;

  public static get instance(): DeadLetterQueue {
    if (!DeadLetterQueue._instance) {
      DeadLetterQueue._instance = new DeadLetterQueue();
    }
    return DeadLetterQueue._instance;
  }

  private constructor() {}

  public init(): void {
    if (this._initialized) return;
    try {
      const db = DBManager.instance.getDB();
      db.exec(`
        CREATE TABLE IF NOT EXISTS dead_letters_ts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          trace_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          failure_phase TEXT NOT NULL DEFAULT '',
          error_code TEXT NOT NULL DEFAULT '',
          owner TEXT NOT NULL DEFAULT 'kernel',
          source_path TEXT NOT NULL DEFAULT '',
          payload TEXT NOT NULL DEFAULT '{}',
          redacted_payload_summary TEXT NOT NULL DEFAULT '',
          error_message TEXT NOT NULL,
          stack_trace TEXT DEFAULT '',
          retry_policy TEXT NOT NULL DEFAULT '',
          replay_command TEXT NOT NULL DEFAULT '',
          diagnostic_hint TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          resolved_at TEXT NOT NULL DEFAULT '',
          resolution TEXT NOT NULL DEFAULT '',
          replayed INTEGER DEFAULT 0
        )
      `);
      ensureColumn(db, 'dead_letters_ts', 'failure_phase', "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, 'dead_letters_ts', 'error_code', "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, 'dead_letters_ts', 'owner', "TEXT NOT NULL DEFAULT 'kernel'");
      ensureColumn(db, 'dead_letters_ts', 'source_path', "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, 'dead_letters_ts', 'redacted_payload_summary', "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, 'dead_letters_ts', 'retry_policy', "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, 'dead_letters_ts', 'replay_command', "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, 'dead_letters_ts', 'diagnostic_hint', "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, 'dead_letters_ts', 'status', "TEXT NOT NULL DEFAULT 'pending'");
      ensureColumn(db, 'dead_letters_ts', 'resolved_at', "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, 'dead_letters_ts', 'resolution', "TEXT NOT NULL DEFAULT ''");
      db.exec('CREATE INDEX IF NOT EXISTS idx_dlts_trace ON dead_letters_ts(trace_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_dlts_event ON dead_letters_ts(event_type)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_dlts_status ON dead_letters_ts(status)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_dlts_created_at ON dead_letters_ts(created_at)');
      this._initialized = true;
      logger.info('TypeScript DLQ 已初始化为恢复队列语义');
    } catch (error) {
      logger.error('DLQ 初始化失败', { error: (error as Error).message });
    }
  }

  public enqueue(
    traceId: string,
    eventType: string,
    payload: unknown,
    error: Error,
    options: DeadLetterEnqueueOptions = {},
  ): void {
    if (!this._initialized) {
      logger.warn('DLQ 未初始化，丢弃死信', { event_type: eventType, trace_id: traceId });
      return;
    }

    const payloadJson = safeJsonStringify(payload);
    const summary = options.redactedPayloadSummary || summarizePayload(payload);

    try {
      const db = DBManager.instance.getDB();
      db.prepare(`
        INSERT INTO dead_letters_ts (
          trace_id,
          event_type,
          failure_phase,
          error_code,
          owner,
          source_path,
          payload,
          redacted_payload_summary,
          error_message,
          stack_trace,
          retry_policy,
          replay_command,
          diagnostic_hint,
          status,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        traceId,
        eventType,
        options.failurePhase ?? 'dispatch',
        options.errorCode ?? '',
        options.owner ?? 'kernel',
        options.sourcePath ?? '',
        payloadJson,
        summary,
        error.message,
        error.stack ?? '',
        options.retryPolicy ?? '',
        options.replayCommand ?? '',
        options.diagnosticHint ?? '',
        'pending',
        new Date().toISOString(),
      );
      logger.warn('事件已写入 TS DLQ 恢复队列', {
        trace_id: traceId,
        event_type: eventType,
        error: error.message,
      });
      recordObservabilityEvent(OBSERVABILITY_EVENT_TYPES.DLQ_ENQUEUED, {
        level: 'warn',
        event_outcome: 'queued',
        trace_id: traceId,
        owner: options.owner ?? 'kernel',
        module: 'dead-letter-queue',
        phase: options.failurePhase ?? 'dispatch',
        error_code: options.errorCode ?? null,
        error_kind: error.name || 'Error',
        diagnostic_hint: options.diagnosticHint ?? error.message,
        attributes: {
          event_type: eventType,
          source_path: options.sourcePath ?? '',
          retry_policy: options.retryPolicy ?? '',
          replay_command: options.replayCommand ?? '',
        },
      });
    } catch (dbError) {
      logger.error('DLQ 写入失败', { error: (dbError as Error).message });
    }
  }

  public queryRecent(limit = 50): DeadLetterRecord[] {
    if (!this._initialized) return [];
    try {
      const db = DBManager.instance.getDB();
      return db.prepare(`
        SELECT id, trace_id, event_type, failure_phase, error_code, owner, source_path, payload,
               redacted_payload_summary, error_message, stack_trace, retry_policy, replay_command,
               diagnostic_hint, status, created_at, resolved_at, resolution, replayed
          FROM dead_letters_ts
         WHERE status != 'resolved'
         ORDER BY created_at DESC
         LIMIT ?
      `).all(limit) as DeadLetterRecord[];
    } catch {
      return [];
    }
  }

  public queryByTrace(traceId: string): DeadLetterRecord[] {
    if (!this._initialized) return [];
    try {
      const db = DBManager.instance.getDB();
      return db.prepare(`
        SELECT id, trace_id, event_type, failure_phase, error_code, owner, source_path, payload,
               redacted_payload_summary, error_message, stack_trace, retry_policy, replay_command,
               diagnostic_hint, status, created_at, resolved_at, resolution, replayed
          FROM dead_letters_ts
         WHERE trace_id = ?
         ORDER BY created_at DESC
      `).all(traceId) as DeadLetterRecord[];
    } catch {
      return [];
    }
  }

  public markReplayed(recordId: number): void {
    if (!this._initialized) return;
    try {
      const db = DBManager.instance.getDB();
      db.prepare(`
        UPDATE dead_letters_ts
           SET replayed = 1,
               status = 'replayed',
               resolved_at = ?,
               resolution = COALESCE(NULLIF(resolution, ''), 'replayed')
         WHERE id = ?
      `).run(new Date().toISOString(), recordId);
    } catch (error) {
      logger.error('标记重放失败', { record_id: recordId, error: (error as Error).message });
    }
  }
}

function ensureColumn(db: ReturnType<typeof DBManager.instance.getDB>, table: string, name: string, sqlType: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === name)) {
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${sqlType}`);
}

function safeJsonStringify(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 0);
  } catch {
    return String(payload);
  }
}

function summarizePayload(payload: unknown): string {
  const text = safeJsonStringify(payload);
  return text.length > 240 ? `${text.slice(0, 240)}...` : text;
}
