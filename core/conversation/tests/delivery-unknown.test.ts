import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DeliveryController, SqliteDeliveryStore } from '../src/index';

describe('Delivery unknown reconciliation', () => {
  it('固定 playout fixture 保持 epoch、generation 与 heard range 单调', () => {
    const events = JSON.parse(readFileSync(
      join(__dirname, 'fixtures', 'playout-events.json'), 'utf8',
    )) as Array<{ authority_epoch: number; generation: number; heard_through: number }>;
    expect(new Set(events.map((event) => event.authority_epoch))).toEqual(new Set([7]));
    expect(new Set(events.map((event) => event.generation))).toEqual(new Set([3]));
    expect(events.map((event) => event.heard_through)).toEqual([0, 12, 12]);
  });

  it('keeps an ambiguous send unknown across restart until an authoritative receipt arrives', () => {
    const root = mkdtempSync(join(tmpdir(), 'glimmer-delivery-unknown-'));
    const databasePath = join(root, 'delivery.db');
    const clock = { nowIso: () => '2026-01-01T00:00:00Z' };
    let store: SqliteDeliveryStore | undefined;
    try {
      store = new SqliteDeliveryStore(databasePath);
      let controller = new DeliveryController(store, 'epoch:stable', clock);
      const output = controller.begin({
        output_id: 'output:unknown',
        turn_id: 'turn:unknown',
        destination_id: 'surface:remote',
        content_digest: 'sha256:unknown',
      });
      controller.queue(output.output_id);
      controller.unknown(output.output_id, 'socket_closed_after_write');
      store.close();

      store = new SqliteDeliveryStore(databasePath);
      controller = new DeliveryController(store, 'epoch:stable', clock);
      expect(controller.recover()).toEqual([
        expect.objectContaining({
          output_id: output.output_id,
          status: 'unknown',
          terminal_reason: 'socket_closed_after_write',
        }),
      ]);
      expect(controller.applyReceipt({
        output_id: output.output_id,
        destination_id: output.destination_id,
        authority_epoch: output.authority_epoch,
        generation: output.generation,
        received_at: '2026-01-01T00:01:00Z',
        receipt: { kind: 'delivered', receipt_id: 'receipt:reconciled' },
      })).toEqual({ accepted: true });
      expect(store.load(output.output_id)?.status).toBe('delivered');
    } finally {
      store?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects malformed receipt metadata before it can contaminate durable delivery state', () => {
    const root = mkdtempSync(join(tmpdir(), 'glimmer-delivery-validation-'));
    const store = new SqliteDeliveryStore(join(root, 'delivery.db'));
    try {
      const controller = new DeliveryController(store, 'epoch:stable');
      const output = controller.begin({
        output_id: 'output:validation',
        turn_id: 'turn:validation',
        destination_id: 'surface:validation',
        content_digest: 'sha256:validation',
      });
      controller.queue(output.output_id);
      controller.sent(output.output_id);
      expect(() => controller.applyReceipt({
        output_id: output.output_id,
        destination_id: output.destination_id,
        authority_epoch: output.authority_epoch,
        generation: output.generation,
        received_at: 'not-a-time',
        receipt: { kind: 'delivered', receipt_id: 'receipt:invalid-time' },
      })).toThrow(/received_at/u);
      expect(store.load(output.output_id)?.status).toBe('sent');
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
