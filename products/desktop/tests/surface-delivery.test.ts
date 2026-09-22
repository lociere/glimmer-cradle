import assert from 'node:assert/strict';
import test from 'node:test';
import { PlaybackReceiptTracker } from '../src/renderer/audio/playback-receipt-tracker.ts';

test('playback receipts accumulate actual heard range and complete only on final segment', () => {
  const tracker = new PlaybackReceiptTracker();
  const metadata = {
    trace_id: 'trace',
    output_id: 'reply:trace',
    destination_id: 'surface:desktop',
    authority_epoch: 'epoch:test',
    generation: 2,
    segment_count: 2,
  } as const;

  assert.deepEqual(tracker.complete({
    ...metadata,
    audio_id: 'audio:0',
    segment_index: 0,
  }, 120), {
    receiptKind: 'playback_progress',
    heardThroughMs: 120,
  });
  assert.deepEqual(tracker.complete({
    ...metadata,
    audio_id: 'audio:1',
    segment_index: 1,
  }, 180), {
    receiptKind: 'playback_completed',
    heardThroughMs: 300,
    durationMs: 300,
  });
});
