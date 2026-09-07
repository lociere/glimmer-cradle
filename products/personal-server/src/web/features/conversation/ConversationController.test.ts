import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationController, type ConversationPort } from './ConversationController';
import type { ConversationHistoryEntry, ConversationHistoryRequest, ConversationHistoryResult } from '../../../shared/control-center-models';

function entry(id: string, position: number, trace?: string): ConversationHistoryEntry {
  return { entry_id: id, position, trace_id: trace, role: 'user', source_kind: 'conversation', status: 'committed', text: id,
    occurred_at: new Date(position * 1000).toISOString(), conversation_id: 'conversation:test', scene_id: 'scene:test', thread_id: 'main', recall_scope: 'conversation_private', disclosure_scope: 'conversation_private' };
}
function result(items: ConversationHistoryEntry[], cursor?: string): ConversationHistoryResult {
  return { request_id: 'fixture', status: 'success', conversation: { source_provider_id: 'test', scene_id: 'scene:test', conversation_id: 'conversation:test', thread_id: 'main', recall_scope: 'conversation_private', disclosure_scope: 'conversation_private' }, items, has_more: Boolean(cursor), next_cursor: cursor };
}
function setup() {
  const reads: Array<{ request: ConversationHistoryRequest; signal: AbortSignal; resolve: (result: ConversationHistoryResult) => void }> = [];
  const sends: Array<{ text: string; trace: string }> = [];
  const port: ConversationPort = {
    read: (request, signal) => new Promise((resolve) => reads.push({ request, signal, resolve })),
    send: (text, trace) => sends.push({ text, trace }),
  };
  const controller = new ConversationController(port);
  controller.start(); controller.setConnected(true);
  return { controller, reads, sends, port };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('latest history preserves an unacknowledged send and suppresses duplicate sends', async () => {
  const { controller, reads, sends } = setup();
  assert.equal(controller.send('新的消息'), true);
  assert.equal(controller.send('连续点击'), false);
  reads[0].resolve(result([entry('older', 1)])); await settle();
  assert.equal(controller.getSnapshot().entries.length, 2);
  controller.handleFrame({ kind: 'reply', trace_id: sends[0].trace, timestamp: 1 });
  reads[1].resolve(result([entry('older', 1), entry('persisted', 2, sends[0].trace)])); await settle();
  assert.deepEqual(controller.getSnapshot().entries.map((item) => item.id), ['older', 'persisted']);
  controller.stop();
});

test('persisted interaction replaces server transient identity without retaining blocking pending entries', async () => {
  const { controller, reads } = setup();
  reads[0].resolve(result([{ ...entry('transient:user:trace', 1, 'trace'), interaction_id: 'trace', source_kind: 'transient', status: 'pending' }])); await settle();
  void controller.refresh();
  reads[1].resolve(result([{ ...entry('persisted', 2), interaction_id: 'trace' }])); await settle();
  assert.deepEqual(controller.getSnapshot().entries.map((item) => item.id), ['persisted']);
  assert.equal(controller.send('下一条消息'), true); controller.stop();
});

test('live refresh invalidates older request and preserves already loaded pages', async () => {
  const { controller, reads } = setup();
  reads[0].resolve(result([entry('recent', 50)], 'cursor-1')); await settle();
  void controller.loadOlder();
  reads[1].resolve(result([entry('old', 1)], 'cursor-2')); await settle();
  void controller.loadOlder();
  controller.handleFrame({ kind: 'reply', timestamp: 1 });
  assert.equal(reads[2].signal.aborted, true);
  reads[3].resolve(result([entry('recent', 50), entry('new', 51)], 'cursor-1')); await settle();
  reads[2].resolve(result([entry('late', 0)])); await settle();
  assert.deepEqual(controller.getSnapshot().entries.map((item) => item.id), ['old', 'recent', 'new']);
  assert.equal(controller.getSnapshot().nextCursor, 'cursor-2');
  controller.stop();
});

test('disconnect invalidates reads and turns pending requests into retryable failures', async () => {
  const { controller, reads, sends } = setup();
  controller.send('保留失败消息'); controller.setConnected(false);
  assert.equal(reads[0].signal.aborted, true);
  reads[0].resolve(result([entry('late', 1)])); await settle();
  assert.equal(controller.getSnapshot().entries[0].status, 'failed');
  controller.setConnected(true);
  reads[1].resolve(result([])); await settle();
  controller.retry(controller.getSnapshot().entries[0].id);
  assert.equal(sends.length, 2);
  assert.equal(controller.getSnapshot().entries.length, 1);
  controller.stop();
});

test('route teardown prevents late history from reaching a restarted owner', async () => {
  const { controller, reads } = setup();
  controller.stop(); controller.start(); controller.setConnected(true);
  reads[0].resolve(result([entry('old-session', 1)])); await settle();
  assert.equal(controller.getSnapshot().entries.length, 0);
  reads[1].resolve(result([entry('current-session', 2)])); await settle();
  assert.equal(controller.getSnapshot().entries[0].id, 'current-session'); controller.stop();
});

test('transport send errors preserve retry state and do not leave phantom pending entries', async () => {
  const { controller, port } = setup();
  port.send = () => { throw new Error('连接已关闭'); };
  assert.equal(controller.send('保留草稿'), false);
  assert.equal(controller.getSnapshot().entries.length, 0);
  assert.equal(controller.getSnapshot().sendError, '连接已关闭'); controller.stop();
});

test('error results and queued live refreshes retain actionable state', async () => {
  const { controller, reads } = setup();
  controller.handleFrame({ kind: 'reply', timestamp: 1 });
  reads[0].resolve({ ...result([]), status: 'error', message: '读取失败' }); await settle();
  assert.equal(reads.length, 2);
  reads[1].resolve(result([entry('recovered', 1)])); await settle();
  assert.equal(controller.getSnapshot().error, '');
  assert.equal(controller.getSnapshot().initialized, true); controller.stop();
});
