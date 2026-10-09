import { createHash, randomUUID } from 'node:crypto';
import { create, toBinary } from '@bufbuild/protobuf';
import type { ServerWritableStream } from '@grpc/grpc-js';
import { snapshotPrincipal, type Principal, type PermissionGrant, type PermissionRequest } from '@glimmer-cradle/platform';
import { type DeliveryController, type DeliveryReceiptEnvelope, type ReceiptDecision } from '@glimmer-cradle/conversation';
import type { PreparePlanningNotificationResponse, ResolvePlanningNotificationResponse } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { SurfaceGatewayServiceStreamResponseSchema, type SurfaceGatewayServiceStreamRequest,
  DeliveryReceiptCommandSchema, type DeliveryReceiptCommand,
  type SurfaceGatewayServiceStreamResponse } from '@glimmer-cradle/contracts/glimmer/surface/v1/surface_gateway_pb';
import { PermissionBroker } from '../broker/permission-broker.js';

export type ConversationRecipientContext = Pick<ResolvePlanningNotificationResponse,
  'context' | 'actorId' | 'privacyClass' | 'recallOwnerId' | 'disclosureOwnerId'>;
type SurfaceStream = ServerWritableStream<SurfaceGatewayServiceStreamRequest, SurfaceGatewayServiceStreamResponse>;
interface Recipient {
  readonly id: string;
  readonly principal: Principal;
  readonly domain: ConversationRecipientContext;
  readonly revision: string;
  readonly receive: PermissionGrant;
  readonly stream: SurfaceStream;
  readonly outputs: Set<string>;
  readonly cleanup: () => void;
  blocked: boolean;
}

/** Host 身份适配器登记已认证接收方；不解析客户端自报身份、不自行授予权限。
 * 只拥有运行期路由，事实与 generation 均委托注入的唯一 Conversation Delivery。
 */
export class HostConversationRoutes {
  private readonly recipients = new Map<string, Recipient>();
  private readonly scenes = new Map<string, string>();
  private readonly unsubscribe: () => void;
  private stopped = false;
  public constructor(private readonly permissions: PermissionBroker, public readonly delivery: DeliveryController,
    private readonly now: () => number) {
    this.unsubscribe = permissions.onRevoked((principal, grant) => {
      for (const recipient of [...this.recipients.values()]) {
        if (recipient.principal.principal_id === principal
          && (!grant || grant === recipient.receive.grant_id || !this.allowed(recipient))) {
          this.detach(recipient.id, 'permission_revoked');
        }
      }
    });
  }

  /** 明确审批时使用同一资源身份；此方法不创建 grant。 */
  public permissionRequest(principal: Principal, domain: ConversationRecipientContext,
    permission: 'conversation.receive' | 'conversation.notify'): PermissionRequest {
    const identity = snapshotPrincipal(principal), revision = this.domainRevision(domain);
    return { principal_id: identity.principal_id, host_id: identity.host_id, generation: identity.generation,
      permission, resource_id: domain.context!.conversationId, resource_revision: revision,
      target_location: domain.context!.sceneId };
  }

  public attach(principal: Principal, domain: ConversationRecipientContext, stream: SurfaceStream): string {
    if (this.stopped) throw new Error('Conversation 路由已停止');
    const revision = this.domainRevision(domain), identity = snapshotPrincipal(principal);
    const receive = this.permissions.authorize(this.permissionRequest(identity, domain, 'conversation.receive'));
    if (!receive.allowed || !this.permissions.isCurrent(receive.grant) || this.stopped) throw new Error('Conversation 接收权限不足');
    const scene = domain.context!.sceneId;
    for (const previous of [...this.recipients.values()]) {
      if (!this.permissions.isCurrent(previous.receive)) this.detach(previous.id, 'receive_permission_expired');
    }
    if (this.scenes.has(scene) || [...this.recipients.values()].some(value => value.stream === stream)
      || this.recipients.size >= 128) throw new Error('Conversation 接收实例冲突或预算耗尽');
    if (stream.destroyed || stream.writableEnded || stream.cancelled) throw new Error('Conversation stream 已关闭');
    const id = randomUUID();
    const close = () => this.detach(id, 'receiver_disconnected');
    const drain = () => { const current = this.recipients.get(id); if (current) current.blocked = false; };
    stream.on('cancelled', close); stream.on('close', close); stream.on('error', close); stream.on('drain', drain);
    // 不保留调用者可变对象；interaction 是一次输入，不是长期接收授权身份。
    const snapshot = Object.freeze({ context: Object.freeze({ ...domain.context! }), actorId: domain.actorId,
      privacyClass: domain.privacyClass, recallOwnerId: domain.recallOwnerId, disclosureOwnerId: domain.disclosureOwnerId });
    const recipient: Recipient = { id, principal: identity, domain: snapshot, revision, receive: receive.grant, stream,
      blocked: false, outputs: new Set(), cleanup: () => {
        stream.off('cancelled', close); stream.off('close', close); stream.off('error', close); stream.off('drain', drain);
      } };
    this.recipients.set(id, recipient); this.scenes.set(scene, id);
    return id;
  }

  public available(domain: ConversationRecipientContext): boolean {
    const recipient = this.recipient(domain);
    return !!recipient && !recipient.blocked && this.allowed(recipient);
  }

  /** prepared 仅来自受监督 Cognition RPC，不把 UI/Extension 自报 accepted DTO 当事实。 */
  public send(prepared: PreparePlanningNotificationResponse, signal?: AbortSignal):
    'unavailable' | 'sent' | 'confirmed' | 'recovery_required' {
    signal?.throwIfAborted();
    if (this.stopped) return 'unavailable';
    this.validatePrepared(prepared);
    const outputId = `reply:${prepared.turnId}`, scene = prepared.context!.sceneId;
    const existing = this.delivery.recordedOutput(outputId);
    if (existing && (existing.turn_id !== prepared.turnId || existing.destination_id !== scene
      || existing.content_digest !== prepared.contentDigest)) throw new Error('Conversation 通知输出身份冲突');
    if (this.delivery.confirmedReceipt(outputId)) return 'confirmed';
    // 无回执的旧/未知输出不能凭新 stream 或新 grant 重发，包括落盘 queued 后崩溃。
    if (existing && (this.delivery.current(outputId) === null || existing.status !== 'generated')) {
      if (existing.status === 'queued' && this.delivery.current(outputId)) this.delivery.unknown(outputId, 'queued_before_recovery');
      return 'recovery_required';
    }
    const recipient = this.recipient(prepared);
    if (!recipient || recipient.blocked || !this.allowed(recipient)) return 'unavailable';
    for (const id of recipient.outputs) {
      const output = this.delivery.current(id);
      if (!output || ['completed', 'interrupted', 'failed'].includes(output.status)) recipient.outputs.delete(id);
    }
    if (recipient.outputs.size >= 128) return 'unavailable';
    const timestamp = this.now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('Conversation 发送时钟无效');
    const output = existing ?? this.delivery.begin({ output_id: outputId, turn_id: prepared.turnId,
      destination_id: scene, content_digest: prepared.contentDigest });
    const frame = create(SurfaceGatewayServiceStreamResponseSchema, { event: { eventId: randomUUID(), traceId: prepared.turnId,
      timestampMs: BigInt(timestamp), event: { case: 'reply', value: { text: prepared.text, outputId, destinationId: scene,
        authorityEpoch: output.authority_epoch, generation: BigInt(output.generation) } } } });
    if (toBinary(SurfaceGatewayServiceStreamResponseSchema, frame).byteLength > 65536) throw new Error('Conversation 发送帧超过预算');
    signal?.throwIfAborted();
    if (!this.allowed(recipient) || recipient.stream.destroyed || recipient.stream.writableEnded || recipient.stream.cancelled) {
      this.detach(recipient.id, 'receiver_unavailable'); return 'unavailable';
    }
    signal?.throwIfAborted();
    this.delivery.queue(outputId); recipient.outputs.add(outputId);
    try {
      // write(false) 仍已接纳进 transport buffer；同步落 sent 后才让远端回执进入事件循环。
      recipient.blocked = !recipient.stream.write(frame);
    } catch {
      if (this.delivery.current(outputId)?.status === 'queued') this.delivery.unknown(outputId, 'surface_write_unknown');
      this.detach(recipient.id, 'surface_write_unknown');
      return 'recovery_required';
    }
    // 存储失败不是 transport 暂时断线，不能吞掉它或假造 sent。
    try { this.delivery.sent(outputId); }
    catch (error) { this.detach(recipient.id, 'delivery_commit_failed'); throw error; }
    return 'sent';
  }

  public applyReceipt(recipientId: string, envelope: DeliveryReceiptEnvelope): ReceiptDecision {
    const recipient = this.recipients.get(recipientId);
    if (!recipient || !this.allowed(recipient) || !recipient.outputs.has(envelope.output_id)
      || recipient.domain.context!.sceneId !== envelope.destination_id) throw new Error('Conversation 回执接收实例或权限无效');
    return this.delivery.applyReceipt(envelope);
  }

  /** 接收已认证 session 的既有 canonical command，不接受另一 stream 的自报 output。 */
  public receiveReceipt(recipientId: string, command: DeliveryReceiptCommand): ReceiptDecision {
    if (toBinary(DeliveryReceiptCommandSchema, command).byteLength > 16384
      || command.generation < 1n || command.generation > BigInt(Number.MAX_SAFE_INTEGER)
      || command.heardThroughMs < 0n || command.heardThroughMs > BigInt(Number.MAX_SAFE_INTEGER)
      || command.durationMs !== undefined && (command.durationMs < 0n || command.durationMs > BigInt(Number.MAX_SAFE_INTEGER))) {
      throw new Error('Conversation 回执超出预算');
    }
    let receipt: DeliveryReceiptEnvelope['receipt'];
    if (command.kind === 'delivered' || command.kind === 'playback_started') {
      if (command.heardThroughMs !== 0n || command.durationMs !== undefined || command.reason) throw new Error('Conversation 回执字段冲突');
      receipt = { kind: command.kind, receipt_id: command.receiptId };
    } else if (command.kind === 'playback_progress' || command.kind === 'playback_completed') {
      if (command.reason) throw new Error('Conversation 播放回执字段冲突');
      receipt = { kind: command.kind, receipt_id: command.receiptId, heard_through_ms: Number(command.heardThroughMs),
        ...(command.durationMs !== undefined ? { duration_ms: Number(command.durationMs) } : {}) };
    } else if (command.kind === 'unknown' || command.kind === 'failed') {
      if (command.heardThroughMs !== 0n || command.durationMs !== undefined) throw new Error('Conversation 终态回执字段冲突');
      receipt = { kind: command.kind, receipt_id: command.receiptId, reason: command.reason };
    } else throw new Error('Conversation 回执 kind 无效');
    return this.applyReceipt(recipientId, { output_id: command.outputId, destination_id: command.destinationId,
      authority_epoch: command.authorityEpoch, generation: Number(command.generation), received_at: command.receivedAt, receipt });
  }

  public detach(recipientId: string, reason = 'receiver_detached'): boolean {
    const recipient = this.recipients.get(recipientId);
    if (!recipient) return false;
    this.recipients.delete(recipientId); this.scenes.delete(recipient.domain.context!.sceneId); recipient.cleanup();
    if (!recipient.stream.destroyed) recipient.stream.destroy();
    // 已接纳回执保留为历史事实；撤路由不能继续接纳本实例的迟到回执。
    if ([...recipient.outputs].some(id => {
      const output = this.delivery.current(id);
      return output && !['completed', 'interrupted', 'failed'].includes(output.status);
    })) this.delivery.interrupt(recipient.domain.context!.sceneId, reason);
    return true;
  }
  public stop(): void {
    if (this.stopped) return;
    this.stopped = true; this.unsubscribe();
    const failures: unknown[] = [];
    for (const recipient of [...this.recipients.values()]) {
      try { this.detach(recipient.id, 'host_routes_stopped'); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Conversation 路由停止失败');
  }

  private allowed(recipient: Recipient): boolean {
    if (this.stopped || !this.permissions.isCurrent(recipient.receive)) return false;
    const decision = this.permissions.authorize(this.permissionRequest(recipient.principal, recipient.domain, 'conversation.notify'));
    // 审计/撤销观察者可以同步重入；authorize 返回不能恢复其间已撤销的能力或路由。
    return decision.allowed && this.permissions.isCurrent(decision.grant) && this.permissions.isCurrent(recipient.receive)
      && this.recipients.get(recipient.id) === recipient && !this.stopped
      && !recipient.stream.destroyed && !recipient.stream.writableEnded && !recipient.stream.cancelled;
  }
  private recipient(domain: ConversationRecipientContext): Recipient | undefined {
    const revision = this.domainRevision(domain), id = this.scenes.get(domain.context!.sceneId);
    const recipient = id ? this.recipients.get(id) : undefined;
    return recipient?.revision === revision ? recipient : undefined;
  }
  private domainRevision(domain: ConversationRecipientContext): string {
    const c = domain.context;
    if (!c) throw new Error('Conversation 接收域缺失');
    const values = [c.sourceProviderId, c.sceneId, c.conversationId, c.continuityId, c.threadId,
      c.recallScope, c.disclosureScope, domain.privacyClass, domain.recallOwnerId, domain.disclosureOwnerId];
    if (values.some(value => typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 4096)
      || domain.actorId !== undefined && (typeof domain.actorId !== 'string' || !domain.actorId.trim() || Buffer.byteLength(domain.actorId) > 4096)
      || !['public', 'private', 'sensitive'].includes(domain.privacyClass)) throw new Error('Conversation 接收域无效');
    const owners: Record<string, string | undefined> = { public: 'public', conversation_private: c.conversationId,
      actor_private: domain.actorId, space_local: c.sceneId };
    if (!Object.hasOwn(owners, c.recallScope) || !Object.hasOwn(owners, c.disclosureScope)
      || owners[c.recallScope] !== domain.recallOwnerId || owners[c.disclosureScope] !== domain.disclosureOwnerId) {
      throw new Error('Conversation 接收 scope owner 冲突或内部域不可外送');
    }
    return createHash('sha256').update(JSON.stringify(['conversation-recipient.v1', ...values, domain.actorId ?? null])).digest('hex');
  }
  private validatePrepared(prepared: PreparePlanningNotificationResponse): void {
    this.domainRevision(prepared);
    const notification = prepared.request?.notificationId;
    if (!prepared.accepted || !notification || !/^[a-f0-9]{64}$/.test(notification)
      || prepared.turnId !== createHash('sha256').update(`conversation-notification-turn.v1:${notification}`).digest('hex')
      || prepared.turnRevision !== 2n || prepared.logPosition < 1n || prepared.logPosition > BigInt(Number.MAX_SAFE_INTEGER)
      || !prepared.replyMomentId.trim() || Buffer.byteLength(prepared.replyMomentId) > 4096
      || !/^[a-f0-9]{64}$/.test(prepared.contentDigest) || prepared.context!.interactionId !== prepared.turnId
      || prepared.request!.scopeId !== prepared.context!.conversationId || !prepared.text.trim()
      || Buffer.byteLength(prepared.text) > 16384) throw new Error('Conversation 通知未由真实 Reply/Turn 接纳');
  }
}
