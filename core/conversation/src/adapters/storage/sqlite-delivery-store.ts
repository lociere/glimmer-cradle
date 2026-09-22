import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type {
  CreateOutputRequest,
  DeliveryStorePort,
  DeliveryTransition,
} from '../../delivery/delivery-store-port.js';
import type { DeliveryStatus, OutputGeneration } from '../../delivery/output-generation.js';

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

export class SqliteDeliveryStore implements DeliveryStorePort {
  private readonly database: Database.Database;

  public constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('foreign_keys = ON');
    const migration = resolve(__dirname, '../../../migrations/002-delivery.sql');
    this.database.exec(readFileSync(migration, 'utf8'));
  }

  public activateEpoch(authorityEpoch: string, activatedAt: string): number {
    return this.database.transaction(() => {
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
    })();
  }

  public allocate(request: CreateOutputRequest): OutputGeneration {
    return this.database.transaction(() => {
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
    })();
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
      if (transition.receipt_id) {
        const inserted = this.database.prepare(
          `INSERT OR IGNORE INTO delivery_receipts(receipt_id,output_id,received_at) VALUES(?,?,?)`,
        ).run(transition.receipt_id, outputId, transition.updated_at);
        if (inserted.changes !== 1) return current;
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
    })();
  }

  public interrupt(
    destinationId: string,
    authorityEpoch: string,
    interruptedAt: string,
    reason: string,
  ): number {
    return this.database.transaction(() => {
      const destination = this.database.prepare(
        `SELECT authority_epoch,generation FROM delivery_destinations WHERE destination_id=?`,
      ).get(destinationId) as DestinationRow | undefined;
      const generation = destination?.authority_epoch === authorityEpoch
        ? destination.generation + 1
        : 1;
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
    })();
  }

  public recover(authorityEpoch: string): OutputGeneration[] {
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

  public receiptOutput(receiptId: string): string | null {
    const row = this.database.prepare(
      `SELECT output_id FROM delivery_receipts WHERE receipt_id=?`,
    ).get(receiptId) as { output_id: string } | undefined;
    return row?.output_id ?? null;
  }

  public close(): void {
    if (this.database.open) this.database.close();
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
}
