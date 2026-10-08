import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type {
  CreateOutputRequest,
  DeliveryStorePort,
  DeliveryTransition,
} from '../../delivery/delivery-store-port.js';
import type { DeliveryStatus, OutputGeneration } from '../../delivery/output-generation.js';
import { validatePlayoutProgress } from '../../delivery/playout.js';
import { DeliveryReceiptConflictError, deliveryReceiptIdentity, validateDeliveryReceipt,
  type DeliveryReceiptFact } from '../../delivery/receipt.js';

type OutputRow = Omit<OutputGeneration, 'duration_ms' | 'terminal_reason'> & {
  duration_ms: number | null;
  terminal_reason: string | null;
};

type DestinationRow = {
  authority_epoch: string;
  generation: number;
};

const ACTIVE_STATUSES = [
  'generated', 'queued', 'sent', 'delivered', 'playing', 'unknown',
] as const;

const AUTHORITY_TABLES = ['delivery_authority_meta', 'delivery_retired_authorities'];
const RECEIPT_TABLES = ['delivery_receipt_meta', 'delivery_receipt_facts'];

export class SqliteDeliveryStore implements DeliveryStorePort {
  private readonly database: Database.Database;

  public constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    try {
      const tables = this.tables();
      const base = ['delivery_outputs', 'delivery_destinations', 'delivery_receipts'];
      if (tables.size && base.some(name => !tables.has(name))) throw new Error('Delivery 库不完整；须受控恢复');
      const authority = this.authoritySchema();
      if (this.receiptSchema() && !authority) throw new Error('Delivery receipt 缺少 authority owner；须受控恢复');
      if (tables.size) {
        this.database.prepare('SELECT destination_id,authority_epoch,generation,updated_at FROM delivery_destinations LIMIT 0').all();
        this.database.prepare('SELECT output_id,turn_id,destination_id,authority_epoch,generation,content_digest,status,heard_through_ms,duration_ms,terminal_reason,created_at,updated_at FROM delivery_outputs LIMIT 0').all();
        this.database.prepare('SELECT receipt_id,output_id,received_at FROM delivery_receipts LIMIT 0').all();
      }
      this.database.pragma('journal_mode = WAL');
      this.database.pragma('foreign_keys = ON');
      const migration = resolve(__dirname, '../../../migrations/002-delivery.sql');
      this.database.exec(readFileSync(migration, 'utf8'));
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  public activateEpoch(authorityEpoch: string, activatedAt: string): number {
    this.identity(authorityEpoch);
    if (!Number.isFinite(Date.parse(activatedAt))) throw new TypeError('Delivery activated_at 无效');
    return this.database.transaction(() => {
      if (!this.authoritySchema()) {
        this.database.exec('CREATE TABLE delivery_authority_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);'
          + 'CREATE TABLE delivery_retired_authorities(authority_epoch TEXT PRIMARY KEY);');
        this.database.prepare('INSERT INTO delivery_authority_meta VALUES(?,?)').run('schema_version', '1');
        this.database.prepare('INSERT INTO delivery_authority_meta VALUES(?,?)').run('authority_epoch', authorityEpoch);
        // 首次可信 App 激活建立增量窗口；旧输出只提供已见身份，不补造租约/回执事实。
        this.database.prepare('INSERT INTO delivery_retired_authorities SELECT DISTINCT authority_epoch FROM delivery_outputs WHERE authority_epoch<>?')
          .run(authorityEpoch);
      } else {
        if (this.database.prepare('SELECT 1 FROM delivery_retired_authorities WHERE authority_epoch=?').get(authorityEpoch)) {
          throw new Error('Delivery 已退出的 authority epoch 不得重新激活');
        }
        const current = this.activeEpoch();
        if (current !== authorityEpoch) {
          this.database.prepare('INSERT INTO delivery_retired_authorities VALUES(?)').run(current);
          this.database.prepare("UPDATE delivery_authority_meta SET value=? WHERE key='authority_epoch'").run(authorityEpoch);
        }
      }
      const interrupted = this.database.prepare(
        `UPDATE delivery_outputs
            SET status='interrupted',terminal_reason='authority_epoch_changed',updated_at=?
          WHERE authority_epoch<>?
            AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})`,
      ).run(activatedAt, authorityEpoch, ...ACTIVE_STATUSES).changes;
      this.database.prepare(
        `UPDATE delivery_destinations
            SET authority_epoch=?,generation=0,updated_at=?
          WHERE authority_epoch<>?`,
      ).run(authorityEpoch, activatedAt, authorityEpoch);
      return interrupted;
    }).immediate();
  }

  public isCurrentEpoch(authorityEpoch: string): boolean {
    return this.authoritySchema() && this.activeEpoch() === authorityEpoch;
  }

  public allocate(request: CreateOutputRequest): OutputGeneration {
    for (const value of [request.output_id, request.turn_id, request.destination_id, request.authority_epoch, request.content_digest]) this.identity(value);
    if (!Number.isFinite(Date.parse(request.created_at))) throw new TypeError('Delivery created_at 无效');
    return this.database.transaction(() => {
      this.assertEpoch(request.authority_epoch);
      const existing = this.load(request.output_id);
      if (existing) {
        if (
          existing.turn_id !== request.turn_id
          || existing.destination_id !== request.destination_id
          || existing.authority_epoch !== request.authority_epoch
          || existing.content_digest !== request.content_digest
        ) {
          throw new Error(`Delivery output identity 冲突: ${request.output_id}`);
        }
        return existing;
      }
      const destination = this.database.prepare(
        `SELECT authority_epoch,generation FROM delivery_destinations WHERE destination_id=?`,
      ).get(request.destination_id) as DestinationRow | undefined;
      const generation = destination?.authority_epoch === request.authority_epoch
        ? destination.generation + 1
        : 1;
      if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('Delivery generation 超出预算');
      const reason = destination && destination.authority_epoch !== request.authority_epoch
        ? 'authority_epoch_changed'
        : 'superseded';
      this.interruptRows(request.destination_id, request.created_at, reason);
      this.database.prepare(
        `INSERT INTO delivery_destinations(destination_id,authority_epoch,generation,updated_at)
         VALUES(?,?,?,?)
         ON CONFLICT(destination_id) DO UPDATE SET
           authority_epoch=excluded.authority_epoch,
           generation=excluded.generation,
           updated_at=excluded.updated_at`,
      ).run(request.destination_id, request.authority_epoch, generation, request.created_at);
      this.database.prepare(
        `INSERT INTO delivery_outputs(
           output_id,turn_id,destination_id,authority_epoch,generation,content_digest,
           status,heard_through_ms,duration_ms,terminal_reason,created_at,updated_at
         ) VALUES(?,?,?,?,?,?,'generated',0,NULL,NULL,?,?)`,
      ).run(
        request.output_id,
        request.turn_id,
        request.destination_id,
        request.authority_epoch,
        generation,
        request.content_digest,
        request.created_at,
        request.created_at,
      );
      return this.required(request.output_id);
    }).immediate();
  }

  public load(outputId: string): OutputGeneration | null {
    const row = this.database.prepare(
      `SELECT output_id,turn_id,destination_id,authority_epoch,generation,content_digest,
              status,heard_through_ms,duration_ms,terminal_reason,created_at,updated_at
         FROM delivery_outputs WHERE output_id=?`,
    ).get(outputId) as OutputRow | undefined;
    return row ?? null;
  }

  public transition(
    outputId: string,
    authorityEpoch: string,
    generation: number,
    allowedStatuses: ReadonlySet<DeliveryStatus>,
    transition: DeliveryTransition,
  ): OutputGeneration | null {
    return this.database.transaction(() => {
      if (!this.isCurrentEpoch(authorityEpoch)) return null;
      const destination = this.database.prepare(
        `SELECT d.authority_epoch,d.generation
           FROM delivery_outputs o
           JOIN delivery_destinations d ON d.destination_id=o.destination_id
          WHERE o.output_id=?`,
      ).get(outputId) as DestinationRow | undefined;
      const current = this.load(outputId);
      if (
        !destination
        || !current
        || destination.authority_epoch !== authorityEpoch
        || destination.generation !== generation
        || current.authority_epoch !== authorityEpoch
        || current.generation !== generation
        || !allowedStatuses.has(current.status)
      ) return null;
      const envelope = transition.receipt;
      if (['delivered', 'playing', 'completed'].includes(transition.status) && !envelope) {
        throw new DeliveryReceiptConflictError('Delivery 外部结果缺少真实回执信封');
      }
      if (!envelope && (transition.heard_through_ms !== undefined || transition.duration_ms !== undefined)) {
        throw new DeliveryReceiptConflictError('Delivery 播放事实缺少真实回执信封');
      }
      if (envelope) {
        validateDeliveryReceipt(envelope);
        const progress = envelope.receipt.kind === 'playback_progress' || envelope.receipt.kind === 'playback_completed';
        const expectedHeard = progress ? envelope.receipt.heard_through_ms : current.heard_through_ms;
        const expectedDuration = progress ? envelope.receipt.duration_ms ?? current.duration_ms : current.duration_ms;
        const expectedReason = envelope.receipt.kind === 'failed' || envelope.receipt.kind === 'unknown'
          ? envelope.receipt.reason.trim() : current.terminal_reason;
        if ((transition.heard_through_ms ?? current.heard_through_ms) !== expectedHeard
          || (transition.duration_ms === undefined ? current.duration_ms : transition.duration_ms) !== expectedDuration
          || (transition.terminal_reason === undefined ? current.terminal_reason : transition.terminal_reason) !== expectedReason) {
          throw new DeliveryReceiptConflictError('Delivery 转换不得篡改回执播放范围/原因');
        }
        if (progress) validatePlayoutProgress(current.heard_through_ms, {
          heard_through_ms: expectedHeard, duration_ms: expectedDuration ?? undefined,
        });
        const expectedStatus = envelope.receipt.kind === 'playback_started' || envelope.receipt.kind === 'playback_progress'
          ? 'playing' : envelope.receipt.kind === 'playback_completed' ? 'completed' : envelope.receipt.kind;
        if (envelope.output_id !== outputId || envelope.destination_id !== current.destination_id
          || envelope.authority_epoch !== authorityEpoch || envelope.generation !== generation
          || expectedStatus !== transition.status || envelope.received_at !== transition.updated_at
          || ('heard_through_ms' in envelope.receipt && envelope.receipt.heard_through_ms !== transition.heard_through_ms)) {
          throw new DeliveryReceiptConflictError('Delivery 回执与原输出/转换冲突');
        }
        const existing = this.receipt(envelope.receipt.receipt_id);
        if (existing) {
          if (deliveryReceiptIdentity(existing.envelope) !== deliveryReceiptIdentity(envelope)) {
            throw new DeliveryReceiptConflictError('Delivery receipt 内容冲突');
          }
          return current;
        }
        this.receiptSchema(true);
        const fact: DeliveryReceiptFact = { envelope, turn_id: current.turn_id, content_digest: current.content_digest };
        const payload = JSON.stringify(fact);
        if (new TextEncoder().encode(payload).length > 65_536) throw new DeliveryReceiptConflictError('Delivery 完整回执事实超过 64 KiB');
        this.database.prepare('INSERT INTO delivery_receipts(receipt_id,output_id,received_at) VALUES(?,?,?)')
          .run(envelope.receipt.receipt_id, outputId, envelope.received_at);
        this.database.prepare('INSERT INTO delivery_receipt_facts(receipt_id,payload_json) VALUES(?,?)')
          .run(envelope.receipt.receipt_id, payload);
      }
      this.database.prepare(
        `UPDATE delivery_outputs SET
           status=?,heard_through_ms=?,duration_ms=?,terminal_reason=?,updated_at=?
         WHERE output_id=?`,
      ).run(
        transition.status,
        transition.heard_through_ms ?? current.heard_through_ms,
        transition.duration_ms === undefined ? current.duration_ms : transition.duration_ms,
        transition.terminal_reason === undefined ? current.terminal_reason : transition.terminal_reason,
        transition.updated_at,
        outputId,
      );
      return this.required(outputId);
    }).immediate();
  }

  public interrupt(
    destinationId: string,
    authorityEpoch: string,
    interruptedAt: string,
    reason: string,
  ): number {
    return this.database.transaction(() => {
      this.assertEpoch(authorityEpoch);
      const destination = this.database.prepare(
        `SELECT authority_epoch,generation FROM delivery_destinations WHERE destination_id=?`,
      ).get(destinationId) as DestinationRow | undefined;
      const generation = destination?.authority_epoch === authorityEpoch
        ? destination.generation + 1
        : 1;
      if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('Delivery generation 超出预算');
      this.interruptRows(destinationId, interruptedAt, reason);
      this.database.prepare(
        `INSERT INTO delivery_destinations(destination_id,authority_epoch,generation,updated_at)
         VALUES(?,?,?,?)
         ON CONFLICT(destination_id) DO UPDATE SET
           authority_epoch=excluded.authority_epoch,
           generation=excluded.generation,
           updated_at=excluded.updated_at`,
      ).run(destinationId, authorityEpoch, generation, interruptedAt);
      return generation;
    }).immediate();
  }

  public recover(authorityEpoch: string): OutputGeneration[] {
    if (!this.isCurrentEpoch(authorityEpoch)) return [];
    return this.database.prepare(
      `SELECT o.output_id,o.turn_id,o.destination_id,o.authority_epoch,o.generation,
              o.content_digest,o.status,o.heard_through_ms,o.duration_ms,
              o.terminal_reason,o.created_at,o.updated_at
         FROM delivery_outputs o
         JOIN delivery_destinations d ON d.destination_id=o.destination_id
        WHERE o.authority_epoch=? AND d.authority_epoch=o.authority_epoch
          AND d.generation=o.generation
          AND o.status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
        ORDER BY o.created_at,o.output_id`,
    ).all(authorityEpoch, ...ACTIVE_STATUSES) as OutputRow[];
  }

  public receipt(receiptId: string): DeliveryReceiptFact | null {
    const row = this.database.prepare(
      `SELECT output_id,received_at FROM delivery_receipts WHERE receipt_id=?`,
    ).get(receiptId) as { output_id: string; received_at: string } | undefined;
    if (!row) return null;
    const value = this.receiptSchema() ? this.database.prepare('SELECT payload_json FROM delivery_receipt_facts WHERE receipt_id=?')
      .get(receiptId) as { payload_json: string } | undefined : undefined;
    if (!value) throw new DeliveryReceiptConflictError('旧 Delivery receipt 没有完整事实；须受控对账');
    try {
      if (typeof value.payload_json !== 'string' || new TextEncoder().encode(value.payload_json).length > 65_536) {
        throw new Error('receipt budget');
      }
      const fact = JSON.parse(value.payload_json) as DeliveryReceiptFact;
      if (!fact || Object.keys(fact).sort().join() !== 'content_digest,envelope,turn_id') throw new Error('receipt fields');
      validateDeliveryReceipt(fact.envelope);
      this.identity(fact.turn_id);
      this.identity(fact.content_digest);
      const output = this.load(row.output_id);
      if (!output || fact.envelope.receipt.receipt_id !== receiptId || fact.envelope.output_id !== row.output_id
        || fact.envelope.received_at !== row.received_at || fact.envelope.destination_id !== output.destination_id
        || fact.envelope.authority_epoch !== output.authority_epoch || fact.envelope.generation !== output.generation
        || fact.turn_id !== output.turn_id || fact.content_digest !== output.content_digest
        || JSON.stringify(fact) !== value.payload_json) throw new Error('receipt binding');
      return fact;
    } catch (error) {
      throw new DeliveryReceiptConflictError('Delivery receipt 事实/原输出冲突', { cause: error });
    }
  }

  public close(): void {
    if (this.database.open) this.database.close();
  }

  public confirmedReceipt(outputId: string): DeliveryReceiptFact | null {
    if (!this.receiptSchema()) return null;
    const row = this.database.prepare("SELECT r.receipt_id FROM delivery_receipts r JOIN delivery_receipt_facts f ON f.receipt_id=r.receipt_id "
      + "WHERE r.output_id=? AND json_extract(f.payload_json,'$.envelope.receipt.kind') IN ('delivered','playback_completed') ORDER BY r.rowid DESC LIMIT 1")
      .get(outputId) as { receipt_id: string } | undefined;
    return row ? this.receipt(row.receipt_id) : null;
  }

  private interruptRows(destinationId: string, interruptedAt: string, reason: string): void {
    this.database.prepare(
      `UPDATE delivery_outputs
          SET status='interrupted',terminal_reason=?,updated_at=?
        WHERE destination_id=? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})`,
    ).run(reason, interruptedAt, destinationId, ...ACTIVE_STATUSES);
  }

  private required(outputId: string): OutputGeneration {
    const output = this.load(outputId);
    if (!output) throw new Error(`Delivery output 写入后丢失: ${outputId}`);
    return output;
  }

  private tables(): Set<string> {
    return new Set((this.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>).map(row => row.name));
  }

  private authoritySchema(): boolean {
    const tables = this.tables(), present = AUTHORITY_TABLES.filter(name => tables.has(name));
    if (!present.length) return false;
    if (present.length !== AUTHORITY_TABLES.length) throw new Error('Delivery authority 窗口不完整；须受控恢复');
    const values = this.database.prepare('SELECT key,value FROM delivery_authority_meta').all() as Array<{ key: string; value: string }>;
    if (values.length !== 2 || values.find(row => row.key === 'schema_version')?.value !== '1') {
      throw new Error('Delivery authority 版本无效；须受控恢复');
    }
    const epoch = values.find(row => row.key === 'authority_epoch')?.value;
    this.identity(epoch);
    this.database.prepare('SELECT authority_epoch FROM delivery_retired_authorities LIMIT 0').all();
    if (this.database.prepare('SELECT 1 FROM delivery_retired_authorities WHERE authority_epoch=?').get(epoch)) {
      throw new Error('Delivery 当前 authority 已退出；须受控恢复');
    }
    return true;
  }

  private receiptSchema(create = false): boolean {
    const tables = this.tables(), present = RECEIPT_TABLES.filter(name => tables.has(name));
    if (!present.length) {
      if (!create) return false;
      this.database.exec('CREATE TABLE delivery_receipt_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);'
        + 'CREATE TABLE delivery_receipt_facts(receipt_id TEXT PRIMARY KEY REFERENCES delivery_receipts(receipt_id),payload_json TEXT NOT NULL);'
        + "INSERT INTO delivery_receipt_meta VALUES('schema_version','1');");
      return true;
    }
    if (present.length !== RECEIPT_TABLES.length) throw new Error('Delivery receipt 窗口不完整；须受控恢复');
    const values = this.database.prepare('SELECT key,value FROM delivery_receipt_meta').all() as Array<{ key: string; value: string }>;
    if (values.length !== 1 || values[0].key !== 'schema_version' || values[0].value !== '1') {
      throw new Error('Delivery receipt 版本无效；须受控恢复');
    }
    this.database.prepare('SELECT receipt_id,payload_json FROM delivery_receipt_facts LIMIT 0').all();
    return true;
  }

  private activeEpoch(): string {
    return (this.database.prepare("SELECT value FROM delivery_authority_meta WHERE key='authority_epoch'").get() as { value: string }).value;
  }

  private assertEpoch(epoch: string): void {
    if (!this.isCurrentEpoch(epoch)) throw new Error('Delivery authority epoch 已失效');
  }

  private identity(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value).length > 4096) {
      throw new TypeError('Delivery 持久身份无效或超过预算');
    }
  }
}
