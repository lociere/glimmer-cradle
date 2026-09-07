import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivityController, type ActivityPort } from './ActivityController';
import type { ObservabilityLogEntry } from '../../shared/api/personal-server-client';
const entry = (id: number): ObservabilityLogEntry => ({ id: String(id), timestamp: new Date(id * 1000).toISOString(), source: 'event', level: 'info', module: 'test', owner: 'test', runtime_id: 'test', trace_id: '', event_type: 'test', message: String(id), raw: '{}' });
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function setup() {
  const reads: Array<{ signal: AbortSignal; resolve(value: readonly ObservabilityLogEntry[]): void }> = [];
  const streams: Array<{ handlers: Parameters<ActivityPort['stream']>[1]; closed: boolean }> = [];
  const controller = new ActivityController({ read: (_, signal) => new Promise((resolve) => reads.push({ signal, resolve })), stream: (_, handlers) => { const stream = { handlers, closed: false }; streams.push(stream); return { close: () => { stream.closed = true; } }; } }, 10);
  controller.start(); return { controller, reads, streams };
}
test('leaving before history resolves never reopens a stream', async () => {
  const { controller, reads, streams } = setup(); controller.stop(); assert.equal(reads[0].signal.aborted, true);
  reads[0].resolve([entry(1)]); await settle(); assert.equal(streams.length, 0);
});
test('new filters own late results and old stream callbacks cannot reconnect after stop', async () => {
  const { controller, reads, streams } = setup(); void controller.refresh({ module: 'new' });
  reads[1].resolve([entry(2)]); await settle(); reads[0].resolve([entry(1)]); await settle();
  assert.equal(controller.getSnapshot().entries[0].id, '2'); assert.equal(streams.length, 1);
  streams[0].handlers.onOpen(); assert.equal(controller.getSnapshot().connection, 'live');
  controller.stop(); streams[0].handlers.onError(); streams[0].handlers.onEntry(entry(3));
  await new Promise((resolve) => setTimeout(resolve, 20)); assert.equal(reads.length, 2); assert.equal(streams[0].closed, true);
});
test('pause buffers at most 200 unique events and resume retains the newest', async () => {
  const { controller, reads, streams } = setup(); reads[0].resolve([entry(1)]); await settle(); controller.setPaused(true);
  for (let id = 2; id <= 251; id++) streams[0].handlers.onEntry(entry(id));
  assert.equal(controller.getSnapshot().entries.length, 1); assert.equal(controller.getSnapshot().buffered.length, 200); assert.equal(controller.getSnapshot().dropped, 50);
  controller.setPaused(false); assert.equal(controller.getSnapshot().entries.length, 200); assert.equal(controller.getSnapshot().entries[0].id, '251'); controller.stop();
});
test('stream error retries once and paused recovery leaves visible entries frozen', async () => {
  const { controller, reads, streams } = setup(); reads[0].resolve([entry(1)]); await settle(); controller.setPaused(true);
  streams[0].handlers.onError(); streams[0].handlers.onError(); await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(reads.length, 2); reads[1].resolve([entry(2), entry(1)]); await settle();
  assert.equal(controller.getSnapshot().entries[0].id, '1'); assert.equal(controller.getSnapshot().buffered[0].id, '2'); controller.stop();
});
