import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assertExecutionId, assertExecutionTime, executionDigest, executionJson, invocationDigest,
  ExecutionConflictError, type Invocation, type InvocationRequest } from '../../execution/invocation.js';
import type { ExecutionJournal } from '../../execution/execution-journal.js';
import type { ExecutionOutcome } from '../../execution/executor-port.js';
import type { ExecutionResultEvent, ExecutionResultReceipt } from '../../execution/execution-journal.js';

type Row = Omit<Invocation, 'target' | 'interaction' | 'authorization' | 'result'> & {
  target_json: string; interaction_json: string | null; authorization_json: string | null; result_json: string | null;
};
const OWNER = 0x47434558;
function code(value: string): void {
  if (!/^[a-z][a-z0-9_.:-]{0,127}$/.test(value)) throw new ExecutionConflictError('Execution error code 无效');
}

/** 单 invocation 的持久 CAS；不冒充 Platform authority，不在打开数据库时接管活跃派发。 */
export class SqliteExecutionJournal implements ExecutionJournal {
  private readonly database: Database.Database;
  public constructor(databasePath: string, migrationPath = resolve(__dirname, '../../../migrations/001-execution-journal.sql')) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    try {
      this.database.pragma('busy_timeout = 5000');
      const version = this.database.pragma('user_version', { simple: true });
      const owner = this.database.pragma('application_id', { simple: true });
      if (version === 0) {
        if (owner !== 0 || this.database.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view','trigger')").all().length) {
          throw new ExecutionConflictError('未知 Execution 数据库；须先受控迁移');
        }
        this.database.transaction(() => this.database.exec(readFileSync(migrationPath, 'utf8'))).immediate();
      } else if (version !== 2) throw new ExecutionConflictError('Execution schema version 不兼容；须受控迁移');
      if (this.database.pragma('application_id', { simple: true }) !== OWNER) throw new ExecutionConflictError('Execution 数据库 owner 无效');
      this.database.prepare(`SELECT invocation_id,scope_id,idempotency_key,target_json,interaction_json,request_digest,state,revision,
        attempt,owner_id,authorization_json,result_json,error_code,side_effects,created_at,updated_at FROM executions LIMIT 0`).all();
      this.database.prepare('SELECT event_id,invocation_id,revision,event_json,created_at,acknowledged_at FROM execution_outbox LIMIT 0').all();
      this.database.pragma('foreign_keys = ON');
      this.database.pragma('journal_mode = WAL');
    } catch (error) { this.database.close(); throw error; }
  }
  public load(id: string): Invocation | null {
    assertExecutionId(id);
    const row = this.database.prepare('SELECT * FROM executions WHERE invocation_id=?').get(id) as Row | undefined;
    if (!row) return null;
    const { target_json, interaction_json, authorization_json, result_json, ...rest } = row;
    return { ...rest, target: JSON.parse(target_json), authorization: authorization_json === null ? null : JSON.parse(authorization_json),
      interaction: interaction_json === null ? null : JSON.parse(interaction_json),
      result: result_json === null ? null : JSON.parse(result_json) };
  }
  public prepare(request: InvocationRequest, now: number): Invocation {
    const digest = invocationDigest(request); assertExecutionTime(now);
    return this.database.transaction(() => {
      const matches = this.database.prepare('SELECT invocation_id,request_digest FROM executions WHERE invocation_id=? OR (scope_id=? AND idempotency_key=?)')
        .all(request.invocation_id, request.scope_id, request.idempotency_key) as { invocation_id: string; request_digest: string }[];
      if (matches.length) {
        if (matches.length !== 1 || matches[0].invocation_id !== request.invocation_id || matches[0].request_digest !== digest) {
          throw new ExecutionConflictError('Execution 稳定 identity 内容冲突');
        }
        return this.load(request.invocation_id)!;
      }
      this.database.prepare(`INSERT INTO executions(invocation_id,scope_id,idempotency_key,target_json,interaction_json,request_digest,
        state,revision,attempt,side_effects,created_at,updated_at) VALUES(?,?,?,?,?,?,'prepared',1,0,'not_dispatched',?,?)`)
        .run(request.invocation_id, request.scope_id, request.idempotency_key, executionJson(request.target),
          request.interaction ? executionJson(request.interaction) : null, digest, now, now);
      return this.load(request.invocation_id)!;
    }).immediate();
  }
  public authorize(invocation: Invocation, decision: unknown, now: number): Invocation {
    executionDigest(decision);
    return this.change(invocation, ['prepared', 'authorized'], now, () => {
      this.database.prepare("UPDATE executions SET state='authorized',authorization_json=?,revision=revision+1,updated_at=? WHERE invocation_id=?")
        .run(executionJson(decision), now, invocation.invocation_id);
    });
  }
  public dispatch(invocation: Invocation, ownerId: string, now: number): Invocation {
    assertExecutionId(ownerId);
    return this.change(invocation, ['authorized'], now, () => {
      this.database.prepare("UPDATE executions SET state='dispatched',owner_id=?,attempt=1,side_effects='unknown',revision=revision+1,updated_at=? WHERE invocation_id=?")
        .run(ownerId, now, invocation.invocation_id);
    });
  }
  public reject(invocation: Invocation, errorCode: string, now: number): Invocation {
    code(errorCode);
    return this.change(invocation, ['prepared', 'authorized'], now, () => this.writeOutcome(invocation,
      { state: 'failed', error_code: errorCode, side_effects: 'none' }, now));
  }
  public finish(invocation: Invocation, outcome: ExecutionOutcome, now: number): Invocation {
    if (!['succeeded', 'failed', 'unknown'].includes(outcome.state)
      || (outcome.state === 'succeeded' && !['confirmed', 'none'].includes(outcome.side_effects))
      || (outcome.state === 'failed' && outcome.side_effects !== 'none')
      || (outcome.state === 'unknown' && outcome.side_effects !== 'unknown')) throw new ExecutionConflictError('Execution 结果证据无效');
    if (outcome.state === 'succeeded') executionDigest(outcome.result); else code(outcome.error_code);
    return this.change(invocation, ['dispatched'], now, () => this.writeOutcome(invocation, outcome, now));
  }
  public readOutbox(limit: number, interactionOnly = false): ExecutionResultEvent[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new ExecutionConflictError('Execution outbox limit 无效');
    const filter = interactionOnly ? "AND json_extract(event_json,'$.invocation.interaction.source_fact_id') IS NOT NULL" : '';
    return (this.database.prepare(`SELECT event_json FROM execution_outbox WHERE acknowledged_at IS NULL ${filter}
      ORDER BY created_at,invocation_id,revision LIMIT ?`).all(limit) as { event_json: string }[]).map(row => JSON.parse(row.event_json));
  }
  public acknowledgeOutbox(receipt: ExecutionResultReceipt, now: number): boolean {
    assertExecutionTime(now); assertExecutionId(receipt.event_id); assertExecutionId(receipt.invocation_id);
    if (receipt.accepted !== true || !Number.isSafeInteger(receipt.revision) || receipt.revision < 1) throw new ExecutionConflictError('Execution receipt 无效');
    return this.database.transaction(() => {
      const row = this.database.prepare('SELECT invocation_id,revision,created_at FROM execution_outbox WHERE event_id=?')
        .get(receipt.event_id) as { invocation_id: string; revision: number; created_at: number } | undefined;
      if (!row) return false;
      if (row.invocation_id !== receipt.invocation_id || row.revision !== receipt.revision || now < row.created_at) {
        throw new ExecutionConflictError('Execution receipt identity/时间冲突');
      }
      this.database.prepare('UPDATE execution_outbox SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE event_id=?').run(now, receipt.event_id);
      return true;
    }).immediate();
  }
  public close(): void { this.database.close(); }
  private change(invocation: Invocation, states: Invocation['state'][], now: number, write: () => void): Invocation {
    assertExecutionTime(now);
    return this.database.transaction(() => {
      const current = this.load(invocation.invocation_id);
      if (!current || current.revision !== invocation.revision || current.request_digest !== invocation.request_digest
        || current.owner_id !== invocation.owner_id || current.attempt !== invocation.attempt || !states.includes(current.state)) {
        throw new ExecutionConflictError('Execution CAS 已失效');
      }
      if (now < current.updated_at || current.revision === Number.MAX_SAFE_INTEGER) throw new ExecutionConflictError('Execution revision/时间无效');
      write();
      return this.load(invocation.invocation_id)!;
    }).immediate();
  }
  private writeOutcome(invocation: Invocation, outcome: ExecutionOutcome, now: number): void {
    this.database.prepare('UPDATE executions SET state=?,result_json=?,error_code=?,side_effects=?,revision=revision+1,updated_at=? WHERE invocation_id=?')
      .run(outcome.state, outcome.state === 'succeeded' ? executionJson(outcome.result) : null,
        outcome.state === 'succeeded' ? null : outcome.error_code, outcome.side_effects, now, invocation.invocation_id);
    const result = this.load(invocation.invocation_id)!;
    const event: ExecutionResultEvent = { event_id: executionDigest([result.invocation_id, result.revision]), invocation: result };
    this.database.prepare('INSERT INTO execution_outbox(event_id,invocation_id,revision,event_json,created_at) VALUES(?,?,?,?,?)')
      .run(event.event_id, result.invocation_id, result.revision, executionJson(event), now);
  }
}
