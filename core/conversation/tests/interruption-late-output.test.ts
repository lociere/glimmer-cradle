import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DeliveryController, SqliteDeliveryStore } from '../src/index';

describe('Delivery generation fencing', () => {
  it('invalidates late output, preserves unknown receipts, and recovers only the current epoch', () => {
    const root = mkdtempSync(join(tmpdir(), 'glimmer-delivery-'));
    const databasePath = join(root, 'delivery.db');
    let now = '2026-01-01T00:00:00Z';
    const clock = { nowIso: () => now };
    let openStore: SqliteDeliveryStore | undefined;
    try {
      const firstStore = new SqliteDeliveryStore(databasePath);
      openStore = firstStore;
      const controller = new DeliveryController(firstStore, 'epoch:1', clock);
      const first = controller.begin({
        output_id: 'output:first',
        turn_id: 'turn:first',
        destination_id: 'surface:desktop',
        content_digest: 'sha256:first',
      });
      controller.queue(first.output_id);
      controller.sent(first.output_id);

      now = '2026-01-01T00:00:01Z';
      const second = controller.begin({
        output_id: 'output:second',
        turn_id: 'turn:second',
        destination_id: 'surface:desktop',
        content_digest: 'sha256:second',
      });
      expect(second.generation).toBe(2);
      expect(firstStore.load(first.output_id)).toMatchObject({
        status: 'interrupted',
        terminal_reason: 'superseded',
      });

      const late = controller.applyReceipt({
        output_id: first.output_id,
        destination_id: first.destination_id,
        authority_epoch: first.authority_epoch,
        generation: first.generation,
        received_at: '2026-01-01T00:00:02Z',
        receipt: {
          kind: 'playback_completed',
          receipt_id: 'receipt:late',
          heard_through_ms: 1000,
          duration_ms: 1000,
        },
      });
      expect(late).toEqual({ accepted: false, reason: 'stale_generation' });
      expect(firstStore.load(first.output_id)?.status).toBe('interrupted');

      controller.queue(second.output_id);
      controller.sent(second.output_id);
      const unknown = controller.applyReceipt({
        output_id: second.output_id,
        destination_id: second.destination_id,
        authority_epoch: second.authority_epoch,
        generation: second.generation,
        received_at: '2026-01-01T00:00:03Z',
        receipt: {
          kind: 'unknown',
          receipt_id: 'receipt:unknown',
          reason: 'connection_lost_after_send',
        },
      });
      expect(unknown).toEqual({ accepted: true });
      expect(firstStore.load(second.output_id)).toMatchObject({
        status: 'unknown',
        terminal_reason: 'connection_lost_after_send',
      });
      firstStore.close();

      const restartedStore = new SqliteDeliveryStore(databasePath);
      openStore = restartedStore;
      const restarted = new DeliveryController(restartedStore, 'epoch:1', clock);
      expect(restarted.recover()).toEqual([
        expect.objectContaining({ output_id: second.output_id, status: 'unknown' }),
      ]);
      const duplicate = restarted.applyReceipt({
        output_id: second.output_id,
        destination_id: second.destination_id,
        authority_epoch: second.authority_epoch,
        generation: second.generation,
        received_at: '2026-01-01T00:00:04Z',
        receipt: {
          kind: 'unknown',
          receipt_id: 'receipt:unknown',
          reason: 'connection_lost_after_send',
        },
      });
      expect(duplicate).toEqual({ accepted: true, reason: 'duplicate' });

      now = '2026-01-01T00:00:05Z';
      const nextAuthority = new DeliveryController(restartedStore, 'epoch:2', clock);
      const third = nextAuthority.begin({
        output_id: 'output:third',
        turn_id: 'turn:third',
        destination_id: 'surface:desktop',
        content_digest: 'sha256:third',
      });
      expect(third.generation).toBe(1);
      expect(nextAuthority.applyReceipt({
        output_id: third.output_id,
        destination_id: third.destination_id,
        authority_epoch: third.authority_epoch,
        generation: third.generation,
        received_at: '2026-01-01T00:00:06Z',
        receipt: {
          kind: 'unknown',
          receipt_id: 'receipt:unknown',
          reason: 'forged_reuse',
        },
      })).toEqual({ accepted: false, reason: 'receipt_conflict' });
      expect(restarted.recover()).toEqual([]);
      expect(restartedStore.load(second.output_id)).toMatchObject({
        status: 'interrupted',
        terminal_reason: 'authority_epoch_changed',
      });
      restartedStore.close();
    } finally {
      openStore?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('records monotonic heard range instead of treating generated audio as heard', () => {
    const root = mkdtempSync(join(tmpdir(), 'glimmer-playout-'));
    const store = new SqliteDeliveryStore(join(root, 'delivery.db'));
    const controller = new DeliveryController(store, 'epoch:playout', {
      nowIso: () => '2026-01-01T00:00:00Z',
    });
    try {
      const output = controller.begin({
        output_id: 'output:playout',
        turn_id: 'turn:playout',
        destination_id: 'audio:default',
        content_digest: 'sha256:audio',
      });
      expect(output.heard_through_ms).toBe(0);
      controller.queue(output.output_id);
      controller.sent(output.output_id);
      controller.applyReceipt({
        output_id: output.output_id,
        destination_id: output.destination_id,
        authority_epoch: output.authority_epoch,
        generation: output.generation,
        received_at: '2026-01-01T00:00:01Z',
        receipt: {
          kind: 'playback_progress',
          receipt_id: 'receipt:progress',
          heard_through_ms: 400,
          duration_ms: 1000,
        },
      });
      expect(store.load(output.output_id)).toMatchObject({
        status: 'playing',
        heard_through_ms: 400,
        duration_ms: 1000,
      });
      expect(() => controller.applyReceipt({
        output_id: output.output_id,
        destination_id: output.destination_id,
        authority_epoch: output.authority_epoch,
        generation: output.generation,
        received_at: '2026-01-01T00:00:02Z',
        receipt: {
          kind: 'playback_progress',
          receipt_id: 'receipt:regression',
          heard_through_ms: 399,
          duration_ms: 1000,
        },
      })).toThrow('播放进度不得倒退');
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
