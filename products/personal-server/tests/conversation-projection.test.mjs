import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const { toBinary, fromBinary } = require('@bufbuild/protobuf');
const { SurfaceEventSchema } = require('@glimmer-cradle/contracts/glimmer/surface/v1/surface_gateway_pb');
const { surfaceEventFromFrame } = require('../../../core/kernel/dist/adapters/surface/surface-grpc-mapper.js');
const { surfaceEventToProjection: serverProjection } = require('../dist/server/websocket/surface-grpc-mapper.js');
const { surfaceEventToProjection: desktopProjection } = require('../../desktop/dist/main/surface-grpc-mapper.js');

test('真实 Kernel → protobuf → 两产品历史投影保留身份、标题和位置', () => {
  const entry = { entry_id: 'persisted-1', source_kind: 'conversation', role: 'user', status: 'committed', text: '相同正文不能用作身份',
    occurred_at: '2026-09-07T08:00:00Z', conversation_id: 'conversation:test', scene_id: 'scene:test', thread_id: 'main',
    recall_scope: 'conversation_private', disclosure_scope: 'conversation_private', trace_id: 'trace-1', interaction_id: 'interaction-1',
    position: 0, title: '消息标题', moment_id: 'moment-1', actor_id: 'actor-1', actor_name: '用户' };
  for (const metadata of [true, false]) {
    const input = { ...entry };
    if (!metadata) for (const key of ['trace_id', 'interaction_id', 'position', 'title', 'moment_id', 'actor_id', 'actor_name']) delete input[key];
    const event = surfaceEventFromFrame({ kind: 'conversation_history_result', timestamp: 1, conversation_history_result: { request_id: 'request-1', status: 'success', items: [input], has_more: false } });
    const wire = fromBinary(SurfaceEventSchema, toBinary(SurfaceEventSchema, event));
    for (const project of [serverProjection, desktopProjection]) {
      const output = project(wire).conversation_history_result.items[0];
      assert.deepEqual(JSON.parse(JSON.stringify(output)), input);
    }
  }
});
