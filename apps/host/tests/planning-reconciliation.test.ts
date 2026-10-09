import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import * as grpc from '@grpc/grpc-js';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DeliveryController, SqliteDeliveryStore } from '@glimmer-cradle/conversation';
import { create, fromBinary, toBinary, type DescMessage, type MessageShape } from '@bufbuild/protobuf';
import { it, expect, vi } from 'vitest';
import type { Job } from '@glimmer-cradle/jobs';
import { JobExecutionIdentitySchema } from '@glimmer-cradle/contracts/glimmer/jobs/v1/jobs_pb';
import { PlanningJobResultSchema, PlanningJobResolution, PlanningJobSourceRequestSchema, GetPlanningJobAdmissionResponseSchema,
  type PlanningJobResult, type GetPlanningJobAdmissionRequest } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { PreparePlanningNotificationResponseSchema, AcknowledgePlanningNotificationResponseSchema,
  ResolvePlanningNotificationResponseSchema, ReadPlanningNotificationsResponseSchema, GetPreparedPlanningNotificationResponseSchema,
  type PreparePlanningNotificationResponse } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { SurfaceGatewayServiceStreamRequestSchema, SurfaceGatewayServiceStreamResponseSchema,
  SurfaceGatewayServiceCommandRequestSchema, SurfaceGatewayServiceCommandResponseSchema, DeliveryReceiptCommandSchema,
  type SurfaceGatewayServiceStreamRequest, type SurfaceGatewayServiceStreamResponse,
  type SurfaceGatewayServiceCommandRequest, type SurfaceGatewayServiceCommandResponse } from '@glimmer-cradle/contracts/glimmer/surface/v1/surface_gateway_pb';
import { PermissionBroker, HostConversationRoutes } from '../src/index.js';
import { CognitionClient, HostCognitionError } from '../src/adapters/protocol/cognition-client.js';
import { ServiceErrorCode } from '@glimmer-cradle/contracts/glimmer/common/v1/service_contract_pb';
import { planningJobEvidence, planningJobRequest } from '../src/adapters/protocol/job-mapper.js';
import { PlanningJobAdapter, PlanningNotificationAdapter } from '../src/composition/cognition-job-adapter.js';

function notification(seed = 'a', scene = 'scene:private'): PreparePlanningNotificationResponse {
  const notificationId = seed.repeat(64), turnId = createHash('sha256').update(`conversation-notification-turn.v1:${notificationId}`).digest('hex');
  return create(PreparePlanningNotificationResponseSchema, { accepted: true, turnId, turnRevision: 2n, replyMomentId: 'moment:' + seed,
    logPosition: 2n, contentDigest: 'f'.repeat(64), text: '已完成目标：真实通知', privacyClass: 'private', actorId: 'actor:one',
    recallOwnerId: 'conversation:one', disclosureOwnerId: 'conversation:one', context: { sourceProviderId: 'provider:one', sceneId: scene,
      conversationId: 'conversation:one', continuityId: 'continuity:one', threadId: 'thread:one', interactionId: turnId,
      recallScope: 'conversation_private', disclosureScope: 'conversation_private' }, request: { notificationId, scopeId: 'conversation:one' } });
}
function notificationRoutes() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-host-recipient-')), store = new SqliteDeliveryStore(path.join(root, 'delivery.db'));
  const delivery = new DeliveryController(store, 'epoch:one');
  let now = 100;
  const audit = vi.fn();
  const broker = new PermissionBroker(() => now, audit);
  const principal = broker.registerPrincipal({ principal_id: 'authenticated:user', host_id: 'host:one', generation: 'session:one', kind: 'user' });
  const routes = new HostConversationRoutes(broker, delivery, () => now), frames: SurfaceGatewayServiceStreamResponse[] = [];
  // 仅用于背压/异常注入；下面真实 gRPC fixture 单独覆盖 production stream/command。
  const stream = new Writable({ objectMode: true, write(frame: SurfaceGatewayServiceStreamResponse, _encoding, callback) { frames.push(frame); callback(); } });
  const prepared = notification();
  const grant = (permission: 'conversation.receive' | 'conversation.notify', value = prepared) => broker.grant(routes.permissionRequest(principal, value, permission), 1000);
  const receive = grant('conversation.receive'), notify = grant('conversation.notify');
  const attach = (value = prepared, target = stream) => routes.attach(principal, value,
    target as grpc.ServerWritableStream<SurfaceGatewayServiceStreamRequest, SurfaceGatewayServiceStreamResponse>);
  const receipt = (value = prepared) => {
    const output = delivery.current('reply:' + value.turnId)!;
    return create(DeliveryReceiptCommandSchema, { outputId: output.output_id, destinationId: output.destination_id,
      authorityEpoch: output.authority_epoch, generation: BigInt(output.generation), receiptId: 'receipt:' + value.turnId,
      kind: 'delivered', receivedAt: '2026-10-08T00:00:00Z' });
  };
  return { root, store, delivery, broker, audit, principal, routes, prepared, stream, frames, receive, notify, grant, attach, receipt,
    time: (value: number) => { now = value; }, close: () => { routes.stop(); stream.destroy(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

it.each(['provider', 'scene', 'conversation', 'continuity', 'thread', 'actor', 'privacy', 'recall', 'disclosure'] as const)
('Host 通知严格绑定实际接收域 %s，拒绝串送且不创建输出', mode => {
  const h = notificationRoutes();
  try {
    h.attach(); const value = notification();
    if (mode === 'provider') value.context!.sourceProviderId = 'other';
    if (mode === 'scene') value.context!.sceneId = 'other';
    if (mode === 'conversation') { value.context!.conversationId = 'other'; value.recallOwnerId = value.disclosureOwnerId = 'other'; value.request!.scopeId = 'other'; }
    if (mode === 'continuity') value.context!.continuityId = 'other';
    if (mode === 'thread') value.context!.threadId = 'other';
    if (mode === 'actor') value.actorId = 'other';
    if (mode === 'privacy') value.privacyClass = 'sensitive';
    if (mode === 'recall') { value.context!.recallScope = 'actor_private'; value.recallOwnerId = value.actorId!; }
    if (mode === 'disclosure') { value.context!.disclosureScope = 'actor_private'; value.disclosureOwnerId = value.actorId!; }
    expect(h.routes.send(value)).toBe('unavailable'); expect(h.frames).toEqual([]);
    expect(h.delivery.recordedOutput('reply:' + value.turnId)).toBeNull();
  } finally { h.close(); }
});
it.each(['no-receive', 'no-notify', 'expired', 'revoked', 'principal', 'cancelled', 'stopped', 'internal', 'owner', 'unaccepted', 'oversize'] as const)
('Host 通知无当前接收能力不写出：%s', mode => {
  const h = notificationRoutes();
  try {
    if (mode === 'no-receive') { h.broker.revokeGrant(h.receive.grant_id); expect(() => h.attach()).toThrow('权限'); return; }
    const id = h.attach();
    if (mode === 'no-notify' || mode === 'revoked') h.broker.revokeGrant(h.notify.grant_id);
    if (mode === 'expired') h.time(1000);
    if (mode === 'principal') h.broker.revokePrincipal(h.principal.principal_id);
    if (mode === 'cancelled') h.stream.emit('cancelled');
    if (mode === 'stopped') h.routes.stop();
    if (mode === 'internal') { h.prepared.context!.recallScope = 'character_internal'; h.prepared.recallOwnerId = h.prepared.context!.continuityId; }
    if (mode === 'owner') h.prepared.disclosureOwnerId = 'other';
    if (mode === 'unaccepted') h.prepared.accepted = false;
    if (mode === 'oversize') h.prepared.text = '文'.repeat(6000);
    if (['internal', 'owner', 'unaccepted', 'oversize'].includes(mode)) expect(() => h.routes.send(h.prepared)).toThrow();
    else expect(h.routes.send(h.prepared)).toBe('unavailable');
    expect(h.frames).toEqual([]); expect(h.delivery.recordedOutput('reply:' + h.prepared.turnId)).toBeNull();
    expect(() => h.routes.applyReceipt(id, { output_id: 'fake', destination_id: 'scene:private', authority_epoch: 'epoch:one', generation: 1,
      received_at: '2026-10-08T00:00:00Z', receipt: { kind: 'delivered', receipt_id: 'fake' } })).toThrow();
  } finally { h.close(); }
});
it('Host 实际回执绑定唯一接收实例；sent/unknown/旧 epoch 不重发，历史确认不需要新 grant', () => {
  const h = notificationRoutes();
  try {
    const id = h.attach(); expect(h.routes.send(h.prepared)).toBe('sent');
    expect(h.routes.send(h.prepared)).toBe('recovery_required'); expect(h.frames).toHaveLength(1);
    expect(() => h.routes.receiveReceipt('observer', h.receipt())).toThrow('实例');
    expect(() => h.routes.receiveReceipt(id, { ...h.receipt(), destinationId: 'other' })).toThrow('实例');
    expect(h.routes.receiveReceipt(id, { ...h.receipt(), generation: 2n })).toMatchObject({ accepted: false });
    expect(h.routes.receiveReceipt(id, h.receipt())).toEqual({ accepted: true });
    expect(h.routes.receiveReceipt(id, h.receipt())).toEqual({ accepted: true, reason: 'duplicate' });
    h.broker.revokeGrant(h.notify.grant_id);
    expect(h.routes.send(h.prepared)).toBe('confirmed'); expect(h.frames).toHaveLength(1);
    const next = new DeliveryController(h.store, 'epoch:next'), nextRoutes = new HostConversationRoutes(h.broker, next, () => 100);
    try { expect(nextRoutes.send(h.prepared)).toBe('confirmed'); expect(() => h.routes.send(h.prepared)).toThrow('epoch'); }
    finally { nextRoutes.stop(); }
  } finally { h.close(); }
});
it.each(['queued', 'unknown', 'next-owner', 'write-failure', 'aborted'] as const)('Host %s 不补造送达或自动重发', mode => {
  const h = notificationRoutes();
  try {
    h.attach(); const outputId = 'reply:' + h.prepared.turnId;
    if (mode === 'aborted') { const abort = new AbortController(); abort.abort(); expect(() => h.routes.send(h.prepared, abort.signal)).toThrow(); expect(h.frames).toEqual([]); return; }
    if (mode === 'write-failure') { vi.spyOn(h.stream, 'write').mockImplementation(() => { throw new Error('real write failed'); }); expect(h.routes.send(h.prepared)).toBe('recovery_required'); }
    else {
      h.delivery.begin({ output_id: outputId, turn_id: h.prepared.turnId, destination_id: h.prepared.context!.sceneId, content_digest: h.prepared.contentDigest });
      h.delivery.queue(outputId);
      if (mode === 'unknown') h.delivery.unknown(outputId, 'lost');
      if (mode === 'next-owner') {
        const nextRoutes = new HostConversationRoutes(h.broker, new DeliveryController(h.store, 'epoch:next'), () => 100);
        try { expect(nextRoutes.send(h.prepared)).toBe('recovery_required'); } finally { nextRoutes.stop(); }
        return;
      }
    }
    expect(h.routes.send(h.prepared)).toBe('recovery_required'); expect(h.frames).toEqual([]);
    expect(h.delivery.confirmedReceipt(outputId)).toBeNull();
  } finally { h.close(); }
});
it('Host 背压不建立第二发送队列，drain 才接纳下一输出，实际接收域快照不可修改', () => {
  const h = notificationRoutes();
  const callbacks: Array<() => void> = [];
  const blocked = new Writable({ objectMode: true, highWaterMark: 1, write(_frame, _encoding, callback) { callbacks.push(callback); } });
  try {
    h.attach(h.prepared, blocked); h.prepared.context!.interactionId = 'mutated-after-attach';
    const first = notification(), second = notification('b');
    expect(h.routes.send(first)).toBe('sent'); expect(h.routes.send(second)).toBe('unavailable');
    expect(h.delivery.recordedOutput('reply:' + second.turnId)).toBeNull();
    callbacks.shift()!(); blocked.emit('drain'); expect(h.routes.send(second)).toBe('sent');
    expect(h.delivery.current('reply:' + first.turnId)?.status).toBe('interrupted');
  } finally { h.close(); blocked.destroy(); }
});
it.each(['unsafe-generation', 'unsafe-progress', 'duration', 'delivered-progress', 'reason', 'unknown-kind', 'unknown-output', 'expired'] as const)
('Host canonical 回执拒绝非法组合或未授权输入 %s，不增加持久事实', mode => {
  const h = notificationRoutes();
  try {
    const id = h.attach(); h.routes.send(h.prepared); const receipt = h.receipt();
    if (mode === 'unsafe-generation') receipt.generation = 9007199254740992n;
    if (mode === 'unsafe-progress') { receipt.kind = 'playback_progress'; receipt.heardThroughMs = 9007199254740992n; }
    if (mode === 'duration') { receipt.kind = 'playback_completed'; receipt.heardThroughMs = 50n; receipt.durationMs = 20n; }
    if (mode === 'delivered-progress') receipt.heardThroughMs = 1n;
    if (mode === 'reason') receipt.reason = 'fake';
    if (mode === 'unknown-kind') receipt.kind = 'interrupted';
    if (mode === 'unknown-output') receipt.outputId = 'forged';
    if (mode === 'expired') h.time(1000);
    expect(() => h.routes.receiveReceipt(id, receipt)).toThrow();
    expect(h.delivery.confirmedReceipt('reply:' + h.prepared.turnId)).toBeNull();
    expect(h.delivery.current('reply:' + h.prepared.turnId)?.status).toBe('sent');
  } finally { h.close(); }
});
it('Host canonical 播放进度保留完整范围，完成事实才成为确认；接收授权到期可受控换实例', () => {
  const h = notificationRoutes();
  try {
    const id = h.attach(); h.routes.send(h.prepared);
    expect(() => h.attach()).toThrow('冲突');
    const started = { ...h.receipt(), receiptId: 'started', kind: 'playback_started' };
    expect(h.routes.receiveReceipt(id, started)).toEqual({ accepted: true });
    expect(h.delivery.confirmedReceipt('reply:' + h.prepared.turnId)).toBeNull();
    const completed = { ...h.receipt(), receiptId: 'completed', kind: 'playback_completed', heardThroughMs: 125n, durationMs: 300n };
    expect(h.routes.receiveReceipt(id, completed)).toEqual({ accepted: true });
    expect(h.delivery.confirmedReceipt('reply:' + h.prepared.turnId)?.envelope.receipt).toEqual({ kind: 'playback_completed', receipt_id: 'completed', heard_through_ms: 125, duration_ms: 300 });
    h.time(1000);
    h.broker.grant(h.routes.permissionRequest(h.principal, h.prepared, 'conversation.receive'), 2000);
    const nextStream = new Writable({ objectMode: true, write(_frame, _encoding, callback) { callback(); } });
    const next = h.attach(h.prepared, nextStream);
    expect(next).not.toBe(id); expect(h.stream.destroyed).toBe(true);
    expect(() => h.routes.receiveReceipt(id, completed)).toThrow('实例');
  } finally { h.close(); }
});
it.each(['attach', 'send', 'receipt', 'abort'] as const)('权限审计同步重入 %s 不能复活已撤销能力或取消后的发送', mode => {
  const h = notificationRoutes(), cancellation = new AbortController();
  try {
    let checks = 0;
    const id = mode !== 'attach' ? h.attach() : '';
    if (mode === 'receipt') h.routes.send(h.prepared);
    h.audit.mockImplementation(event => {
      if (event.action !== 'permission_checked' || !event.allowed) return;
      if (mode === 'abort') { if (++checks === 2) cancellation.abort(); }
      else h.broker.revokeGrant(mode === 'attach' ? h.receive.grant_id : h.notify.grant_id);
    });
    if (mode === 'attach') expect(() => h.attach()).toThrow('权限');
    else if (mode === 'receipt') expect(() => h.routes.receiveReceipt(id, h.receipt())).toThrow();
    else if (mode === 'abort') expect(() => h.routes.send(h.prepared, cancellation.signal)).toThrow();
    else expect(h.routes.send(h.prepared)).toBe('unavailable');
    expect(h.frames).toHaveLength(mode === 'receipt' ? 1 : 0);
    expect(h.delivery.confirmedReceipt('reply:' + h.prepared.turnId)).toBeNull();
  } finally { h.close(); }
});
it('Host 接收实例预算有界、同一 stream 不重复登记，过期实例可回收且停机移除监听器', () => {
  const h = notificationRoutes();
  const streams: Writable[] = [];
  try {
    h.attach();
    const other = notification('b', 'scene:other'); h.grant('conversation.receive', other);
    expect(() => h.attach(other)).toThrow('冲突');
    for (let index = 1; index < 128; index++) {
      const value = notification('a', 'scene:' + index); h.grant('conversation.receive', value);
      const stream = new Writable({ objectMode: true, write(_frame, _encoding, callback) { callback(); } });
      streams.push(stream); h.attach(value, stream);
    }
    const overflow = new Writable({ objectMode: true }); streams.push(overflow);
    expect(() => h.attach(other, overflow)).toThrow('预算');
    h.time(1000); h.broker.grant(h.routes.permissionRequest(h.principal, other, 'conversation.receive'), 2000);
    expect(h.attach(other, overflow)).not.toBe(''); expect(h.stream.destroyed).toBe(true);
    expect(streams.slice(0, 127).every(value => value.destroyed && value.listenerCount('drain') === 0)).toBe(true);
    h.routes.stop(); expect(overflow.destroyed).toBe(true); expect(overflow.listenerCount('cancelled')).toBe(0);
  } finally { h.close(); streams.forEach(value => value.destroy()); }
});

const requestId = 'a'.repeat(64), commitmentId = '承诺:一';

function encode<T extends DescMessage>(schema: T) { return (value: MessageShape<T>) => Buffer.from(toBinary(schema, value)); }
function decode<T extends DescMessage>(schema: T) { return (value: Buffer) => fromBinary(schema, value); }

it('实际本地 gRPC stream 收到定向 Reply，canonical command 回执落唯一 Delivery 后才允许源确认', async () => {
  const h = notificationRoutes(), server = new grpc.Server();
  const streamPath = '/glimmer.surface.v1.SurfaceGatewayService/Stream', commandPath = '/glimmer.surface.v1.SurfaceGatewayService/Command';
  let recipientId = '';
  let attachResolve!: () => void;
  const attached = new Promise<void>(resolve => { attachResolve = resolve; });
  server.addService({
    Stream: { path: streamPath, requestStream: false, responseStream: true,
      requestSerialize: encode(SurfaceGatewayServiceStreamRequestSchema), requestDeserialize: decode(SurfaceGatewayServiceStreamRequestSchema),
      responseSerialize: encode(SurfaceGatewayServiceStreamResponseSchema), responseDeserialize: decode(SurfaceGatewayServiceStreamResponseSchema) },
    Command: { path: commandPath, requestStream: false, responseStream: false,
      requestSerialize: encode(SurfaceGatewayServiceCommandRequestSchema), requestDeserialize: decode(SurfaceGatewayServiceCommandRequestSchema),
      responseSerialize: encode(SurfaceGatewayServiceCommandResponseSchema), responseDeserialize: decode(SurfaceGatewayServiceCommandResponseSchema) },
  }, {
    Stream: (call: grpc.ServerWritableStream<SurfaceGatewayServiceStreamRequest, SurfaceGatewayServiceStreamResponse>) => {
      // fixture 的身份由服务端预登记，不将 request 中任意 principal/actor 当认证。
      if (call.request.sessionId !== 'trusted-fixture') { call.destroy(Object.assign(new Error('denied'), { code: grpc.status.PERMISSION_DENIED })); return; }
      recipientId = h.routes.attach(h.principal, h.prepared, call); attachResolve();
    },
    Command: (call: grpc.ServerUnaryCall<SurfaceGatewayServiceCommandRequest, SurfaceGatewayServiceCommandResponse>,
      callback: grpc.sendUnaryData<SurfaceGatewayServiceCommandResponse>) => {
      if (call.request.sessionId !== 'trusted-fixture' || call.request.command.case !== 'deliveryReceipt') {
        callback(Object.assign(new Error('denied'), { code: grpc.status.PERMISSION_DENIED })); return;
      }
      try {
        const decision = h.routes.receiveReceipt(recipientId, call.request.command.value);
        callback(null, create(SurfaceGatewayServiceCommandResponseSchema, { status: decision.accepted ? 'accepted' : 'rejected' }));
      } catch (error) { callback(Object.assign(new Error(String(error)), { code: grpc.status.PERMISSION_DENIED })); }
    },
  });
  const port = await new Promise<number>((resolve, reject) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(),
    (error, value) => error ? reject(error) : resolve(value)));
  const client = new grpc.Client('127.0.0.1:' + port, grpc.credentials.createInsecure());
  const reader = client.makeServerStreamRequest(streamPath, encode(SurfaceGatewayServiceStreamRequestSchema), decode(SurfaceGatewayServiceStreamResponseSchema),
    create(SurfaceGatewayServiceStreamRequestSchema, { sessionId: 'trusted-fixture' }), { deadline: Date.now() + 10000 });
  reader.on('error', () => undefined);
  const received = new Promise<SurfaceGatewayServiceStreamResponse>(resolve => reader.once('data', resolve));
  const command = (sessionId: string) => new Promise<SurfaceGatewayServiceCommandResponse>((resolve, reject) => client.makeUnaryRequest(commandPath,
    encode(SurfaceGatewayServiceCommandRequestSchema), decode(SurfaceGatewayServiceCommandResponseSchema), create(SurfaceGatewayServiceCommandRequestSchema,
      { sessionId, command: { case: 'deliveryReceipt', value: h.receipt() } }), { deadline: Date.now() + 10000 },
    (error, value) => error ? reject(error) : resolve(value!)));
  try {
    await attached;
    expect(h.routes.send(h.prepared)).toBe('sent');
    const frame = await received;
    expect(frame.event?.event).toMatchObject({ case: 'reply', value: { text: h.prepared.text, outputId: 'reply:' + h.prepared.turnId,
      destinationId: 'scene:private', authorityEpoch: 'epoch:one', generation: 1n } });
    expect(h.delivery.confirmedReceipt('reply:' + h.prepared.turnId)).toBeNull();
    await expect(command('observer')).rejects.toMatchObject({ code: grpc.status.PERMISSION_DENIED });
    expect((await command('trusted-fixture')).status).toBe('accepted');
    expect(h.delivery.confirmedReceipt('reply:' + h.prepared.turnId)).toMatchObject({ turn_id: h.prepared.turnId, content_digest: h.prepared.contentDigest });
    expect(h.routes.send(h.prepared)).toBe('confirmed');
  } finally { reader.cancel(); client.close(); server.forceShutdown(); h.close(); }
}, 15000);

it('通知 Adapter 跨未授权首项前进，sent 不 ACK、真实回执才确认，短非空页继续直到空页回绕', async () => {
  const h = notificationRoutes();
  const first = notification('a', 'scene:unavailable'), second = notification('b');
  const reads: string[] = [], prepared: string[] = [], acknowledgements: string[] = [];
  const client = {
    readPlanningNotifications: vi.fn(async (request: { afterNotificationId?: string }) => {
      const cursor = request.afterNotificationId ?? ''; reads.push(cursor);
      return create(ReadPlanningNotificationsResponseSchema, { requests: [first, second].filter(value => value.request!.notificationId > cursor).slice(0, 1).map(value => value.request!) });
    }),
    resolvePlanningNotification: vi.fn(async (request: { request?: { notificationId: string } }) => {
      const value = request.request?.notificationId === first.request!.notificationId ? first : second;
      return create(ResolvePlanningNotificationResponseSchema, { request: value.request, context: value.context, actorId: value.actorId,
        privacyClass: value.privacyClass, recallOwnerId: value.recallOwnerId, disclosureOwnerId: value.disclosureOwnerId, available: true });
    }),
    preparePlanningNotification: vi.fn(async (request: { request?: { notificationId: string } }) => { prepared.push(request.request!.notificationId); return second; }),
    getPreparedPlanningNotification: vi.fn(async () => create(GetPreparedPlanningNotificationResponseSchema,
      { original: create(PreparePlanningNotificationResponseSchema, { ...second, text: '' }) })),
    acknowledgeDeliveredPlanningNotification: vi.fn(async (value: PreparePlanningNotificationResponse, outputId: string, delivery: DeliveryController) => {
      expect(delivery.confirmedReceipt(outputId)?.turn_id).toBe(value.turnId); acknowledgements.push(value.request!.notificationId);
      return create(AcknowledgePlanningNotificationResponseSchema, { accepted: true, notificationId: value.request!.notificationId });
    }),
  };
  const adapter = new PlanningNotificationAdapter(client, h.routes, () => undefined);
  try {
    const id = h.attach();
    await adapter.deliver(10); expect(prepared).toEqual([]);
    await adapter.deliver(10); expect(h.frames).toHaveLength(1); expect(acknowledgements).toEqual([]);
    h.routes.receiveReceipt(id, h.receipt(second)); h.broker.revokeGrant(h.notify.grant_id);
    await adapter.deliver(10); await adapter.deliver(10); await adapter.deliver(10);
    expect(reads).toEqual(['', 'a'.repeat(64), 'b'.repeat(64), '', 'a'.repeat(64)]);
    expect(h.frames).toHaveLength(1); expect(acknowledgements).toEqual(['b'.repeat(64)]);
    expect(client.getPreparedPlanningNotification).toHaveBeenCalledOnce();
    expect(prepared).toEqual(['b'.repeat(64)]);
  } finally { h.close(); }
});
it.each(['none', 'missing', 'wrong-id', 'wrong-goal', 'body', 'cancelled', 'lease'] as const)
('实际回执后的历史对账不解析/重接纳/重发，历史身份 %s 须经确认', async mode => {
  const h = notificationRoutes(), cancellation = new AbortController(); let current = true;
  const client = {
    readPlanningNotifications: vi.fn(async () => create(ReadPlanningNotificationsResponseSchema, { requests: [h.prepared.request!] })),
    resolvePlanningNotification: vi.fn(), preparePlanningNotification: vi.fn(),
    getPreparedPlanningNotification: vi.fn(async () => {
      if (mode === 'cancelled') cancellation.abort();
      if (mode === 'lease') current = false;
      const original = create(PreparePlanningNotificationResponseSchema, { ...h.prepared, text: mode === 'body' ? '不可从历史查询发送的正文' : '' });
      if (mode === 'wrong-id') original.request!.notificationId = 'b'.repeat(64);
      if (mode === 'wrong-goal') original.request!.goalId = 'foreign';
      return create(GetPreparedPlanningNotificationResponseSchema, mode === 'missing' ? {} : { original });
    }),
    acknowledgeDeliveredPlanningNotification: vi.fn(async () => create(AcknowledgePlanningNotificationResponseSchema,
      { notificationId: h.prepared.request!.notificationId, accepted: true })),
  };
  const adapter = new PlanningNotificationAdapter(client, h.routes, () => { if (!current) throw new Error('lease lost'); });
  try {
    const id = h.attach(); h.routes.send(h.prepared); h.routes.receiveReceipt(id, h.receipt());
    h.broker.revokePrincipal(h.principal.principal_id);
    if (mode === 'none') await adapter.deliver(1, cancellation.signal);
    else await expect(adapter.deliver(1, cancellation.signal)).rejects.toThrow();
    expect(client.resolvePlanningNotification).not.toHaveBeenCalled(); expect(client.preparePlanningNotification).not.toHaveBeenCalled();
    expect(client.acknowledgeDeliveredPlanningNotification).toHaveBeenCalledTimes(mode === 'none' ? 1 : 0);
    expect(h.frames).toHaveLength(1);
  } finally { h.close(); }
});
it.each(['lease', 'abort', 'scope-changed', 'source-permission'] as const)('通知 Prepare 等待后复验 %s，不凭旧 Resolve 写出或源确认', async mode => {
  const h = notificationRoutes(), signal = new AbortController(); let current = true;
  const client = {
    readPlanningNotifications: vi.fn(async () => create(ReadPlanningNotificationsResponseSchema, { requests: [h.prepared.request!] })),
    resolvePlanningNotification: vi.fn(async () => create(ResolvePlanningNotificationResponseSchema, { request: h.prepared.request,
      context: h.prepared.context, actorId: h.prepared.actorId, privacyClass: h.prepared.privacyClass,
      recallOwnerId: h.prepared.recallOwnerId, disclosureOwnerId: h.prepared.disclosureOwnerId, available: true })),
    preparePlanningNotification: vi.fn(async () => {
      if (mode === 'lease') current = false;
      if (mode === 'abort') signal.abort();
      if (mode === 'scope-changed') h.prepared.actorId = 'foreign';
      if (mode === 'source-permission') throw new HostCognitionError(ServiceErrorCode.PERMISSION_DENIED);
      return h.prepared;
    }),
    getPreparedPlanningNotification: vi.fn(),
    acknowledgeDeliveredPlanningNotification: vi.fn(),
  };
  const adapter = new PlanningNotificationAdapter(client, h.routes, () => { if (!current) throw new Error('lease lost'); });
  try {
    h.attach();
    if (mode === 'scope-changed' || mode === 'source-permission') await adapter.deliver(1, signal.signal);
    else await expect(adapter.deliver(1, signal.signal)).rejects.toThrow();
    expect(h.frames).toEqual([]); expect(client.acknowledgeDeliveredPlanningNotification).not.toHaveBeenCalled();
    expect(h.delivery.recordedOutput('reply:' + h.prepared.turnId)).toBeNull();
  } finally { h.close(); }
});

it.each(['delivered', 'completed', 'new-owner', 'generated', 'queued', 'sent', 'unknown', 'playing', 'stale-owner',
  'turn', 'digest', 'destination', 'accepted', 'request', 'context', 'revision', 'position', 'overflow', 'response'] as const)
('Planning 源确认只读实际 Delivery owner，拒绝无确认/错绑定 %s', async mode => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-notification-receipt-'));
  const store = new SqliteDeliveryStore(path.join(root, 'delivery.db'));
  const original = new DeliveryController(store, 'epoch:first');
  let delivery = original;
  const receiptId = createHash('sha256').update(`planning-evaluation.v1:${requestId}`).digest('hex');
  const notificationId = createHash('sha256').update(`planning-completion.v1:${receiptId}`).digest('hex');
  const turnId = createHash('sha256').update(`conversation-notification-turn.v1:${notificationId}`).digest('hex');
  const prepared = create(PreparePlanningNotificationResponseSchema, { accepted: true, turnId, turnRevision: 2n,
    replyMomentId: 'moment:original', logPosition: 2n, contentDigest: 'f'.repeat(64), context: { sceneId: 'scene:private' },
    request: { notificationId, receiptId, requestId, jobId: `planning:${requestId}`, commitmentId, commitmentRevision: 2n,
      goalId: 'goal:original', goalVersion: 1n, scopeId: 'conversation:original', sourceMomentId: 'moment:source', sourceDigest: 'e'.repeat(64) } });
  const outputId = 'reply:' + turnId;
  const client = new CognitionClient('grpc://127.0.0.1:1', 'generation:current', 500);
  // 这里只验证实际 SQLite→Host mapper；真实 RPC/Worker/重启另由 production CLI fixture 覆盖。
  const call = vi.spyOn(client as unknown as { call: (...args: unknown[]) => Promise<unknown> }, 'call')
    .mockResolvedValue(create(AcknowledgePlanningNotificationResponseSchema, { accepted: true,
      notificationId: mode === 'response' ? 'foreign' : notificationId }));
  try {
    delivery.begin({ output_id: outputId, turn_id: mode === 'turn' ? 'foreign' : turnId,
      destination_id: mode === 'destination' ? 'foreign' : 'scene:private', content_digest: mode === 'digest' ? 'e'.repeat(64) : 'f'.repeat(64) });
    if (mode !== 'generated') delivery.queue(outputId);
    if (mode !== 'generated' && mode !== 'queued') delivery.sent(outputId);
    if (mode === 'unknown') delivery.unknown(outputId, 'actual_disconnect');
    else if (!['generated', 'queued', 'sent'].includes(mode)) {
      if (mode === 'completed') delivery.applyReceipt({ output_id: outputId, destination_id: 'scene:private',
        authority_epoch: 'epoch:first', generation: 1, received_at: '2026-10-08T00:00:00Z',
        receipt: { receipt_id: 'receipt:started', kind: 'playback_started' } });
      expect(delivery.applyReceipt({ output_id: outputId, destination_id: mode === 'destination' ? 'foreign' : 'scene:private',
        authority_epoch: 'epoch:first', generation: 1, received_at: '2026-10-08T00:00:00Z',
        receipt: mode === 'playing' ? { receipt_id: 'receipt:actual', kind: 'playback_started' }
          : mode === 'completed' ? { receipt_id: 'receipt:actual', kind: 'playback_completed', heard_through_ms: 125, duration_ms: 300 }
          : { receipt_id: 'receipt:actual', kind: 'delivered' } })).toEqual({ accepted: true });
    }
    if (mode === 'new-owner') delivery = new DeliveryController(store, 'epoch:next');
    if (mode === 'stale-owner') new DeliveryController(store, 'epoch:next');
    if (mode === 'accepted') prepared.accepted = false;
    if (mode === 'request') prepared.request = undefined;
    if (mode === 'context') prepared.context = undefined;
    if (mode === 'revision') prepared.turnRevision = 3n;
    if (mode === 'position') prepared.logPosition = 0n;
    if (mode === 'overflow') prepared.logPosition = 9007199254740992n;
    if (['delivered', 'completed', 'new-owner'].includes(mode)) {
      expect(await client.acknowledgeDeliveredPlanningNotification(prepared, outputId, delivery)).toMatchObject({ accepted: true, notificationId });
      expect(call).toHaveBeenCalledOnce();
      const request = call.mock.calls[0][3] as { confirmation: { receipt: { kind: string; authorityEpoch: string }; contentDigest: string } };
      expect(request.confirmation.contentDigest).toBe('f'.repeat(64));
      expect(request.confirmation.receipt.authorityEpoch).toBe('epoch:first');
      expect(request.confirmation.receipt.kind).toBe(mode === 'completed' ? 'playback_completed' : 'delivered');
    } else {
      await expect(client.acknowledgeDeliveredPlanningNotification(prepared, outputId, delivery)).rejects.toThrow();
      expect(call).toHaveBeenCalledTimes(mode === 'response' ? 1 : 0);
    }
  } finally { client.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});
const identity = create(JobExecutionIdentitySchema, { jobId: `planning:${requestId}`, scopeId: '对话:私有',
  attempt: 2n, authorityEpoch: 2n, fencingToken: 2n, ownerId: '接任者', leaseUntilMs: 1000n });
function sign(result: PlanningJobResult) {
  const actual = result.identity!;
  result.evidenceId = createHash('sha256').update(JSON.stringify(['planning-reconciliation.v1', actual.jobId, actual.scopeId,
    Number(actual.attempt), Number(actual.authorityEpoch), Number(actual.fencingToken), actual.ownerId,
    Number(actual.leaseUntilMs), result.requestId, result.resolution === PlanningJobResolution.APPLIED ? 'applied' : 'not_applied',
    result.resolution === PlanningJobResolution.APPLIED ? result.receipt?.receiptId : 'sealed', Number(result.observedAtMs)])).digest('hex');
  return result;
}
function result(applied = true, completed = false) {
  return sign(create(PlanningJobResultSchema, { identity: { ...identity }, requestId, sourceId: 'cognition.planning', receiverFenced: true,
    resolution: applied ? PlanningJobResolution.APPLIED : PlanningJobResolution.NOT_APPLIED, observedAtMs: 200n,
    ...(applied ? { receipt: {
      receiptId: createHash('sha256').update(`planning-evaluation.v1:${requestId}`).digest('hex'),
      identity: { ...identity, attempt: 1n, authorityEpoch: 1n, fencingToken: 1n, ownerId: '原提交者' },
      requestId, commitmentId, commitmentRevision: 2n, completed, reason: '尚未满足全部条件', committedAtMs: 100n,
      evidenceIds: ['事实:一'], evidence: [{ evidenceId: '事实:一', sourceOwner: 'conversation',
        scopeId: identity.scopeId, revision: 1n, contentDigest: 'b'.repeat(64) }],
    } } : {}) }));
}

it.each([false, true])('Planning applied 保留语义完成值 %s 与真实原提交者', completed => {
  expect(planningJobEvidence(result(true, completed), identity, requestId, commitmentId)).toMatchObject({
    resolution: 'applied', attempt: 2, owner_id: '接任者', result: {
      commitment_revision: 2, assessment: { completed }, identity: { attempt: 1, owner_id: '原提交者' },
      evidence: [{ evidence_id: '事实:一', source_owner: 'conversation' }],
    },
  });
});
it('Planning 否定证明必须没有 receipt', () => {
  expect(planningJobEvidence(result(false), identity, requestId, commitmentId)).toMatchObject({ resolution: 'not_applied', receiver_fenced: true });
  const contaminated = result(false); contaminated.receipt = result().receipt;
  expect(() => planningJobEvidence(contaminated, identity, requestId, commitmentId)).toThrow();
});
it.each(['scope', 'attempt', 'epoch', 'token', 'owner', 'lease', 'source', 'request', 'seal', 'resolution', 'digest', 'time'] as const)
('Planning 拒绝错 %s；重算摘要不能提高来源权限', mode => {
  const value = result();
  if (mode === 'scope') value.identity!.scopeId = 'foreign';
  if (mode === 'attempt') value.identity!.attempt++;
  if (mode === 'epoch') value.identity!.authorityEpoch++;
  if (mode === 'token') value.identity!.fencingToken++;
  if (mode === 'owner') value.identity!.ownerId = 'other';
  if (mode === 'lease') value.identity!.leaseUntilMs++;
  if (mode === 'source') value.sourceId = 'cognition.memory';
  if (mode === 'request') value.requestId = 'b'.repeat(64);
  if (mode === 'seal') value.receiverFenced = false;
  if (mode === 'resolution') value.resolution = PlanningJobResolution.UNSPECIFIED;
  if (mode === 'time') value.observedAtMs = 9007199254740992n;
  sign(value);
  if (mode === 'digest') value.evidenceId = 'forged';
  expect(() => planningJobEvidence(value, identity, requestId, commitmentId)).toThrow();
});
it.each(['missing', 'id', 'request', 'commitment', 'revision', 'committer', 'deadline', 'commit-time', 'future', 'owner',
  'ref-owner', 'ref-scope', 'ref-digest', 'ref-revision', 'ref-duplicate', 'foreign-ref', 'complete-empty', 'reason', 'budget'] as const)
('Planning 拒绝 receipt %s，不能用 Job success 代替完成证据', mode => {
  const value = result(), receipt = value.receipt!;
  if (mode === 'missing') value.receipt = undefined;
  if (mode === 'id') receipt.receiptId = 'forged';
  if (mode === 'request') receipt.requestId = 'b'.repeat(64);
  if (mode === 'commitment') receipt.commitmentId = 'foreign';
  if (mode === 'revision') receipt.commitmentRevision = 9007199254740992n;
  if (mode === 'committer') receipt.identity!.jobId = 'foreign';
  if (mode === 'deadline') receipt.identity!.leaseUntilMs = 100n;
  if (mode === 'commit-time') receipt.committedAtMs = 201n;
  if (mode === 'future') receipt.identity!.attempt = 3n;
  if (mode === 'owner') { receipt.identity = { ...identity, ownerId: 'foreign' }; }
  if (mode === 'ref-owner') receipt.evidence[0].sourceOwner = 'model';
  if (mode === 'ref-scope') receipt.evidence[0].scopeId = 'foreign';
  if (mode === 'ref-digest') receipt.evidence[0].contentDigest = 'forged';
  if (mode === 'ref-revision') receipt.evidence[0].revision = 0n;
  if (mode === 'ref-duplicate') receipt.evidence.push(receipt.evidence[0]);
  if (mode === 'foreign-ref') receipt.evidenceIds = ['foreign'];
  if (mode === 'complete-empty') { receipt.completed = true; receipt.evidenceIds = []; }
  if (mode === 'reason') receipt.reason = ' ';
  if (mode === 'budget') receipt.reason = 'x'.repeat(65537);
  sign(value);
  expect(() => planningJobEvidence(value, identity, requestId, commitmentId)).toThrow();
});

it.each(['ready', 'unbound', 'source', 'policy', 'model', 'request', 'job', 'scope', 'unknown-reason',
  'true-with-waiting', 'false-with-ready', 'cancel-before', 'cancel-during', 'source-drift'] as const)
('Planning 调度接纳 %s 不伪造 attempt，错身份/组合与取消失败关闭', async mode => {
  const source = create(PlanningJobSourceRequestSchema, { commitmentId, planId: 'plan:一', planVersion: 1n,
    goalId: 'goal:一', goalVersion: 1n, scopeId: identity.scopeId, dueAtMs: 0n,
    requestId: createHash('sha256').update(JSON.stringify(['planning.evaluate', commitmentId, 'plan:一', 1])).digest('hex') });
  const job: Job = { ...planningJobRequest(source, 3), status: 'queued', revision: 1, attempt: 0,
    authority_epoch: 1, fencing_token: 0, lease_owner: null, lease_until: null, result: null,
    error_code: null, created_at: 0, updated_at: 0 };
  const reason = { ready: 'planning_ready', unbound: 'planning_source_unbound', source: 'planning_source_unavailable',
    policy: 'planning_model_policy', model: 'planning_model_unavailable' };
  const response = create(GetPlanningJobAdmissionResponseSchema, { requestId: source.requestId, jobId: job.job_id,
    scopeId: job.scope_id, eligible: mode === 'ready' || mode === 'true-with-waiting',
    reasonCode: mode in reason ? reason[mode as keyof typeof reason] : 'planning_source_unbound' });
  if (mode === 'request') response.requestId = 'b'.repeat(64);
  if (mode === 'job') response.jobId = 'foreign';
  if (mode === 'scope') response.scopeId = 'foreign';
  if (mode === 'unknown-reason') response.reasonCode = 'future-ready';
  if (mode === 'false-with-ready') response.reasonCode = 'planning_ready';
  const signal = new AbortController();
  const getPlanningAdmission = vi.fn(async (request: GetPlanningJobAdmissionRequest) => {
    expect(request).toMatchObject({ requestId: source.requestId, jobId: job.job_id, scopeId: job.scope_id });
    expect(request).not.toHaveProperty('identity');
    if (mode === 'cancel-during') signal.abort();
    return response;
  });
  if (mode === 'cancel-before') signal.abort();
  const executePlanning = vi.fn(), reconcilePlanning = vi.fn();
  const adapter = new PlanningJobAdapter({ getPlanningAdmission, executePlanning, reconcilePlanning, publishPlanningState: vi.fn() });
  const candidate = mode === 'source-drift' ? { ...job, payload: { ...job.payload, plan_version: 2 } } : job;
  if (mode in reason) expect(await adapter.isEligible(job, signal.signal)).toBe(mode === 'ready');
  else await expect(adapter.isEligible(candidate, signal.signal)).rejects.toThrow();
  expect(getPlanningAdmission).toHaveBeenCalledTimes(mode === 'cancel-before' || mode === 'source-drift' ? 0 : 1);
  expect(executePlanning).not.toHaveBeenCalled(); expect(reconcilePlanning).not.toHaveBeenCalled();
  expect(job.attempt).toBe(0); expect(job.revision).toBe(1);
});
