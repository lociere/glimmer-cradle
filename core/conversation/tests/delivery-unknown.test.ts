import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DeliveryController, SqliteDeliveryStore } from '../src/index';

describe('Delivery unknown reconciliation', () => {
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
});

