import { randomUUID } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import { create, fromBinary, toBinary, type DescMessage, type MessageShape } from '@bufbuild/protobuf';
import { fromJson, type JsonValue } from '@bufbuild/protobuf';
import { ValueSchema } from '@bufbuild/protobuf/wkt';
import type { ExecutionResultEvent, ExecutionResultReceipt } from '@glimmer-cradle/capabilities';
import { validateDeliveryReceipt, type DeliveryController } from '@glimmer-cradle/conversation';
import { DeliveryReceiptCommandSchema } from '@glimmer-cradle/contracts/glimmer/surface/v1/surface_gateway_pb';
import { ExecutionResultState, ExecutionSideEffects } from '@glimmer-cradle/contracts/glimmer/capabilities/v1/capabilities_pb';
import { CallMetadataSchema, ServiceErrorDetailSchema, ServiceErrorCode } from '@glimmer-cradle/contracts/glimmer/common/v1/service_contract_pb';
import {
  ExecuteMemoryJobRequestSchema, ExecuteMemoryJobResponseSchema,
  ReconcileMemoryJobRequestSchema, ReconcileMemoryJobResponseSchema,
  ReadMemoryJobRequestsRequestSchema, ReadMemoryJobRequestsResponseSchema,
  AcknowledgeMemoryJobRequestRequestSchema, AcknowledgeMemoryJobRequestResponseSchema,
  GetReadinessRequestSchema, GetReadinessResponseSchema, ShutdownRequestSchema, ShutdownResponseSchema,
  PublishMemoryJobStateRequestSchema, PublishMemoryJobStateResponseSchema,
  ReadPlanningJobRequestsRequestSchema, ReadPlanningJobRequestsResponseSchema,
  AcknowledgePlanningJobRequestRequestSchema, AcknowledgePlanningJobRequestResponseSchema,
  ReconcilePlanningJobRequestSchema, ReconcilePlanningJobResponseSchema,
  type ReconcilePlanningJobRequest, type ReconcilePlanningJobResponse,
  AcceptPlanningCommitmentRequestSchema, AcceptPlanningCommitmentResponseSchema,
  ExecutePlanningJobRequestSchema, ExecutePlanningJobResponseSchema,
  GetPlanningJobAdmissionRequestSchema, GetPlanningJobAdmissionResponseSchema,
  PublishPlanningJobStateRequestSchema, PublishPlanningJobStateResponseSchema,
  ReadPlanningNotificationsRequestSchema, ReadPlanningNotificationsResponseSchema,
  ResolvePlanningNotificationRequestSchema, ResolvePlanningNotificationResponseSchema,
  PreparePlanningNotificationRequestSchema, PreparePlanningNotificationResponseSchema,
  GetPreparedPlanningNotificationRequestSchema, GetPreparedPlanningNotificationResponseSchema,
  AcknowledgePlanningNotificationRequestSchema, AcknowledgePlanningNotificationResponseSchema,
  PlanningNotificationDeliveryConfirmationSchema,
  type AcknowledgePlanningNotificationResponse,
  type ReadPlanningNotificationsRequest, type ReadPlanningNotificationsResponse,
  type ResolvePlanningNotificationRequest, type ResolvePlanningNotificationResponse,
  type PreparePlanningNotificationRequest, type PreparePlanningNotificationResponse,
  type GetPreparedPlanningNotificationRequest, type GetPreparedPlanningNotificationResponse,
  type PublishPlanningJobStateRequest, type PublishPlanningJobStateResponse,
  type GetPlanningJobAdmissionRequest, type GetPlanningJobAdmissionResponse,
  type AcceptPlanningCommitmentRequest, type AcceptPlanningCommitmentResponse,
  type ExecutePlanningJobRequest, type ExecutePlanningJobResponse,
  type ReadPlanningJobRequestsRequest, type ReadPlanningJobRequestsResponse,
  type AcknowledgePlanningJobRequestRequest, type AcknowledgePlanningJobRequestResponse,
  type PublishMemoryJobStateRequest, type PublishMemoryJobStateResponse,
  type ExecuteMemoryJobRequest, type ExecuteMemoryJobResponse,
  type ReconcileMemoryJobRequest, type ReconcileMemoryJobResponse,
  type ReadMemoryJobRequestsRequest, type ReadMemoryJobRequestsResponse,
  type AcknowledgeMemoryJobRequestRequest, type AcknowledgeMemoryJobRequestResponse,
  SubmitPerceptionRequestSchema, SubmitPerceptionResponseSchema,
  GetPerceptionOperationRequestSchema, GetPerceptionOperationResponseSchema,
  type SubmitPerceptionRequest, type GetPerceptionOperationRequest,
  CognitionService,
  GetKnowledgeResourceSourceRequestSchema, GetKnowledgeResourceSourceResponseSchema,
  RegisterKnowledgeResourceSourceRequestSchema, RegisterKnowledgeResourceSourceResponseSchema,
  CollectKnowledgeSourceRequestSchema, CollectKnowledgeSourceResponseSchema,
  type RegisterKnowledgeResourceSourceRequest,
} from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { AcceptExecutionResultRequestSchema, AcceptExecutionResultResponseSchema, ConversationService } from '@glimmer-cradle/contracts/glimmer/conversation/v1/conversation_pb';

export interface MemoryJobsCognitionPort {
  execute(request: ExecuteMemoryJobRequest, signal?: AbortSignal): Promise<ExecuteMemoryJobResponse>;
  reconcile(request: ReconcileMemoryJobRequest, signal?: AbortSignal): Promise<ReconcileMemoryJobResponse>;
  readRequests(request: ReadMemoryJobRequestsRequest, signal?: AbortSignal): Promise<ReadMemoryJobRequestsResponse>;
  acknowledge(request: AcknowledgeMemoryJobRequestRequest, signal?: AbortSignal): Promise<AcknowledgeMemoryJobRequestResponse>;
  publishJobState(request: PublishMemoryJobStateRequest, signal?: AbortSignal): Promise<PublishMemoryJobStateResponse>;
}

export interface PlanningJobsSourcePort {
  readPlanningRequests(request: ReadPlanningJobRequestsRequest, signal?: AbortSignal): Promise<ReadPlanningJobRequestsResponse>;
  acknowledgePlanning(request: AcknowledgePlanningJobRequestRequest, signal?: AbortSignal): Promise<AcknowledgePlanningJobRequestResponse>;
}

export interface PlanningJobsReconciliationPort {
  reconcilePlanning(request: ReconcilePlanningJobRequest, signal?: AbortSignal): Promise<ReconcilePlanningJobResponse>;
}

export interface PlanningJobsCognitionPort extends PlanningJobsReconciliationPort {
  executePlanning(request: ExecutePlanningJobRequest, signal?: AbortSignal): Promise<ExecutePlanningJobResponse>;
  getPlanningAdmission(request: GetPlanningJobAdmissionRequest, signal?: AbortSignal): Promise<GetPlanningJobAdmissionResponse>;
  publishPlanningState(request: PublishPlanningJobStateRequest, signal?: AbortSignal): Promise<PublishPlanningJobStateResponse>;
}

export interface PlanningNotificationsCognitionPort {
  readPlanningNotifications(request: ReadPlanningNotificationsRequest, signal?: AbortSignal): Promise<ReadPlanningNotificationsResponse>;
  resolvePlanningNotification(request: ResolvePlanningNotificationRequest, signal?: AbortSignal): Promise<ResolvePlanningNotificationResponse>;
  preparePlanningNotification(request: PreparePlanningNotificationRequest, signal?: AbortSignal): Promise<PreparePlanningNotificationResponse>;
  getPreparedPlanningNotification(request: GetPreparedPlanningNotificationRequest, signal?: AbortSignal): Promise<GetPreparedPlanningNotificationResponse>;
  acknowledgeDeliveredPlanningNotification(prepared: PreparePlanningNotificationResponse, outputId: string,
    delivery: DeliveryController, signal?: AbortSignal): Promise<AcknowledgePlanningNotificationResponse>;
}

export class HostCognitionError extends Error {
  public constructor(public readonly code: ServiceErrorCode) { super('受监督 Cognition Service 请求失败'); }
}

/** 端点及 generation 由监督 owner 注入；切代必须撤销旧 client，不自造或发现 authority。 */
export class CognitionClient implements MemoryJobsCognitionPort, PlanningJobsSourcePort, PlanningJobsCognitionPort, PlanningNotificationsCognitionPort {
  private readonly client: grpc.Client;
  private readonly inflight = new Set<grpc.ClientUnaryCall>();
  private closed = false;

  public constructor(endpoint: string, private readonly generation: string, private readonly timeoutMs = 30_000) {
    if (!/^grpc:\/\/127\.0\.0\.1:\d+$/.test(endpoint) || !generation.trim()
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Cognition client 监督参数无效');
    this.client = new grpc.Client(endpoint.slice('grpc://'.length), grpc.credentials.createInsecure());
  }

  public execute(request: ExecuteMemoryJobRequest, signal?: AbortSignal): Promise<ExecuteMemoryJobResponse> {
    return this.call('ExecuteMemoryJob', ExecuteMemoryJobRequestSchema, ExecuteMemoryJobResponseSchema,
      create(ExecuteMemoryJobRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  public submitPerception(request: SubmitPerceptionRequest, signal?: AbortSignal) {
    const call = request.call ? create(CallMetadataSchema, { ...request.call, generation: this.generation }) : this.metadata();
    if (!call.traceId) call.traceId = randomUUID();
    return this.call('SubmitPerception', SubmitPerceptionRequestSchema, SubmitPerceptionResponseSchema,
      create(SubmitPerceptionRequestSchema, { ...request, call }), signal);
  }
  public perceptionOperation(request: GetPerceptionOperationRequest, signal?: AbortSignal) {
    return this.call('GetPerceptionOperation', GetPerceptionOperationRequestSchema, GetPerceptionOperationResponseSchema,
      create(GetPerceptionOperationRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  public async acceptExecutionResult(event: ExecutionResultEvent, signal?: AbortSignal): Promise<ExecutionResultReceipt> {
    const invocation = event.invocation, interaction = invocation.interaction;
    if (!interaction || !['succeeded', 'failed', 'unknown'].includes(invocation.state)) throw new Error('不可投递的 Execution 结果');
    const call = this.metadata(); call.causationId = interaction.source_fact_id;
    call.correlationId = invocation.invocation_id; call.idempotencyKey = event.event_id;
    const request = create(AcceptExecutionResultRequestSchema, { call, event: {
      eventId: event.event_id, invocationId: invocation.invocation_id, revision: BigInt(invocation.revision),
      attempt: invocation.attempt, scopeId: invocation.scope_id, conversationId: interaction.conversation_id,
      sourceFactId: interaction.source_fact_id, executorId: invocation.target.executor_id,
      capabilityId: invocation.target.capability_id, definitionRevision: invocation.target.definition_revision,
      requestDigest: invocation.request_digest,
      state: invocation.state === 'succeeded' ? ExecutionResultState.SUCCEEDED
        : invocation.state === 'failed' ? ExecutionResultState.FAILED : ExecutionResultState.UNKNOWN,
      sideEffects: invocation.side_effects === 'confirmed' ? ExecutionSideEffects.CONFIRMED
        : invocation.side_effects === 'unknown' ? ExecutionSideEffects.UNKNOWN : ExecutionSideEffects.NONE,
      ...(invocation.state === 'succeeded' ? { result: fromJson(ValueSchema, invocation.result as JsonValue) } : {}),
      errorCode: invocation.error_code ?? '', updatedAtMs: BigInt(invocation.updated_at),
    } });
    if (toBinary(AcceptExecutionResultRequestSchema, request).length > 128 * 1024) throw new Error('Execution wire 超过接收上限');
    const receipt = await this.call('AcceptExecutionResult', AcceptExecutionResultRequestSchema, AcceptExecutionResultResponseSchema, request, signal, ConversationService.typeName);
    if (!receipt.accepted || receipt.eventId !== event.event_id || receipt.invocationId !== invocation.invocation_id
      || receipt.revision !== BigInt(invocation.revision) || !receipt.momentId.trim()
      || receipt.logPosition < 1n || receipt.logPosition > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Conversation durable receipt 无效');
    return { event_id: receipt.eventId, invocation_id: receipt.invocationId, revision: Number(receipt.revision), accepted: true };
  }
  public readiness(signal?: AbortSignal) {
    return this.call('GetReadiness', GetReadinessRequestSchema, GetReadinessResponseSchema,
      create(GetReadinessRequestSchema, { call: this.metadata() }), signal);
  }
  public getKnowledgeSource(sourceId: string, signal?: AbortSignal) {
    return this.call('GetKnowledgeResourceSource', GetKnowledgeResourceSourceRequestSchema, GetKnowledgeResourceSourceResponseSchema,
      create(GetKnowledgeResourceSourceRequestSchema, { call: this.metadata(), sourceId }), signal);
  }
  public registerKnowledgeSource(request: RegisterKnowledgeResourceSourceRequest, signal?: AbortSignal) {
    return this.call('RegisterKnowledgeResourceSource', RegisterKnowledgeResourceSourceRequestSchema, RegisterKnowledgeResourceSourceResponseSchema,
      create(RegisterKnowledgeResourceSourceRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  public collectKnowledgeSource(sourceId: string, expectedSourceRevision: bigint, signal?: AbortSignal) {
    return this.call('CollectKnowledgeSource', CollectKnowledgeSourceRequestSchema, CollectKnowledgeSourceResponseSchema,
      create(CollectKnowledgeSourceRequestSchema, { call: this.metadata(), sourceId, expectedSourceRevision }), signal);
  }
  public shutdown(reason: string, signal?: AbortSignal) {
    const call = this.metadata(); call.idempotencyKey = `shutdown:${this.generation}`;
    return this.call('Shutdown', ShutdownRequestSchema, ShutdownResponseSchema,
      create(ShutdownRequestSchema, { call, reason }), signal);
  }
  public reconcile(request: ReconcileMemoryJobRequest, signal?: AbortSignal): Promise<ReconcileMemoryJobResponse> {
    return this.call('ReconcileMemoryJob', ReconcileMemoryJobRequestSchema, ReconcileMemoryJobResponseSchema,
      create(ReconcileMemoryJobRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  public readRequests(request: ReadMemoryJobRequestsRequest, signal?: AbortSignal): Promise<ReadMemoryJobRequestsResponse> {
    return this.call('ReadMemoryJobRequests', ReadMemoryJobRequestsRequestSchema, ReadMemoryJobRequestsResponseSchema,
      create(ReadMemoryJobRequestsRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  public acknowledge(request: AcknowledgeMemoryJobRequestRequest, signal?: AbortSignal): Promise<AcknowledgeMemoryJobRequestResponse> {
    return this.call('AcknowledgeMemoryJobRequest', AcknowledgeMemoryJobRequestRequestSchema, AcknowledgeMemoryJobRequestResponseSchema,
      create(AcknowledgeMemoryJobRequestRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  public reconcilePlanning(request: ReconcilePlanningJobRequest, signal?: AbortSignal): Promise<ReconcilePlanningJobResponse> {
    return this.call('ReconcilePlanningJob', ReconcilePlanningJobRequestSchema, ReconcilePlanningJobResponseSchema,
      create(ReconcilePlanningJobRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  public acceptPlanningCommitment(request: AcceptPlanningCommitmentRequest, signal?: AbortSignal): Promise<AcceptPlanningCommitmentResponse> {
    return this.call('AcceptPlanningCommitment', AcceptPlanningCommitmentRequestSchema, AcceptPlanningCommitmentResponseSchema,
      create(AcceptPlanningCommitmentRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  public executePlanning(request: ExecutePlanningJobRequest, signal?: AbortSignal): Promise<ExecutePlanningJobResponse> {
    return this.call('ExecutePlanningJob', ExecutePlanningJobRequestSchema, ExecutePlanningJobResponseSchema,
      create(ExecutePlanningJobRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  public getPlanningAdmission(request: GetPlanningJobAdmissionRequest, signal?: AbortSignal): Promise<GetPlanningJobAdmissionResponse> {
    return this.call('GetPlanningJobAdmission', GetPlanningJobAdmissionRequestSchema, GetPlanningJobAdmissionResponseSchema,
      create(GetPlanningJobAdmissionRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  public publishPlanningState(request: PublishPlanningJobStateRequest, signal?: AbortSignal): Promise<PublishPlanningJobStateResponse> {
    return this.call('PublishPlanningJobState', PublishPlanningJobStateRequestSchema, PublishPlanningJobStateResponseSchema,
      create(PublishPlanningJobStateRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  public readPlanningNotifications(request: ReadPlanningNotificationsRequest, signal?: AbortSignal): Promise<ReadPlanningNotificationsResponse> {
    return this.call('ReadPlanningNotifications', ReadPlanningNotificationsRequestSchema, ReadPlanningNotificationsResponseSchema,
      create(ReadPlanningNotificationsRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  public resolvePlanningNotification(request: ResolvePlanningNotificationRequest, signal?: AbortSignal): Promise<ResolvePlanningNotificationResponse> {
    return this.call('ResolvePlanningNotification', ResolvePlanningNotificationRequestSchema, ResolvePlanningNotificationResponseSchema,
      create(ResolvePlanningNotificationRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  public preparePlanningNotification(request: PreparePlanningNotificationRequest, signal?: AbortSignal): Promise<PreparePlanningNotificationResponse> {
    return this.call('PreparePlanningNotification', PreparePlanningNotificationRequestSchema, PreparePlanningNotificationResponseSchema,
      create(PreparePlanningNotificationRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  public getPreparedPlanningNotification(request: GetPreparedPlanningNotificationRequest, signal?: AbortSignal): Promise<GetPreparedPlanningNotificationResponse> {
    return this.call('GetPreparedPlanningNotification', GetPreparedPlanningNotificationRequestSchema, GetPreparedPlanningNotificationResponseSchema,
      create(GetPreparedPlanningNotificationRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  /** 只从唯一 Delivery owner 读取历史确认；调用方不能传入 delivered 布尔值或自报回执。 */
  public async acknowledgeDeliveredPlanningNotification(prepared: PreparePlanningNotificationResponse, outputId: string,
    delivery: DeliveryController, signal?: AbortSignal): Promise<AcknowledgePlanningNotificationResponse> {
    signal?.throwIfAborted();
    const fact = delivery.confirmedReceipt(outputId);
    if (!prepared.accepted || !prepared.request || !prepared.context || !fact) {
      throw new Error('Planning 通知没有真实内部接纳/已持久送达回执');
    }
    validateDeliveryReceipt(fact.envelope);
    const envelope = fact.envelope, receipt = envelope.receipt;
    if (envelope.output_id !== outputId || fact.turn_id !== prepared.turnId || fact.content_digest !== prepared.contentDigest
      || envelope.destination_id !== prepared.context.sceneId || !['delivered', 'playback_completed'].includes(receipt.kind)
      || prepared.turnRevision !== 2n || prepared.logPosition <= 0n || prepared.logPosition > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Planning 通知实际送达回执与原 Reply/Turn/目的地冲突');
    }
    const response = await this.call('AcknowledgePlanningNotification', AcknowledgePlanningNotificationRequestSchema,
      AcknowledgePlanningNotificationResponseSchema, create(AcknowledgePlanningNotificationRequestSchema, {
        call: this.metadata(), request: prepared.request,
        confirmation: create(PlanningNotificationDeliveryConfirmationSchema, { turnId: fact.turn_id,
          replyMomentId: prepared.replyMomentId, logPosition: prepared.logPosition, contentDigest: fact.content_digest,
          receipt: create(DeliveryReceiptCommandSchema, { outputId: envelope.output_id,
            destinationId: envelope.destination_id, authorityEpoch: envelope.authority_epoch, generation: BigInt(envelope.generation),
            receiptId: receipt.receipt_id, kind: receipt.kind, receivedAt: envelope.received_at,
            ...('heard_through_ms' in receipt ? { heardThroughMs: BigInt(receipt.heard_through_ms),
              ...(receipt.duration_ms === undefined ? {} : { durationMs: BigInt(receipt.duration_ms) }) } : {}) }) }),
      }), signal);
    if (!response.accepted || response.notificationId !== prepared.request.notificationId) {
      throw new Error('Planning 通知源确认响应与原引用冲突');
    }
    return response;
  }
  public readPlanningRequests(request: ReadPlanningJobRequestsRequest, signal?: AbortSignal): Promise<ReadPlanningJobRequestsResponse> {
    return this.call('ReadPlanningJobRequests', ReadPlanningJobRequestsRequestSchema, ReadPlanningJobRequestsResponseSchema,
      create(ReadPlanningJobRequestsRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  public acknowledgePlanning(request: AcknowledgePlanningJobRequestRequest, signal?: AbortSignal): Promise<AcknowledgePlanningJobRequestResponse> {
    return this.call('AcknowledgePlanningJobRequest', AcknowledgePlanningJobRequestRequestSchema, AcknowledgePlanningJobRequestResponseSchema,
      create(AcknowledgePlanningJobRequestRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  public close(): void {
    this.closed = true;
    for (const call of this.inflight) call.cancel();
    this.client.close();
  }
  public publishJobState(request: PublishMemoryJobStateRequest, signal?: AbortSignal): Promise<PublishMemoryJobStateResponse> {
    return this.call('PublishMemoryJobState', PublishMemoryJobStateRequestSchema, PublishMemoryJobStateResponseSchema,
      create(PublishMemoryJobStateRequestSchema, { ...request, call: this.metadata() }), signal);
  }
  private metadata() { return create(CallMetadataSchema, { traceId: randomUUID(), generation: this.generation }); }
  private call<I extends DescMessage, O extends DescMessage>(name: string, input: I, output: O,
    request: MessageShape<I>, signal?: AbortSignal, serviceName: string = CognitionService.typeName): Promise<MessageShape<O>> {
    if (this.closed) return Promise.reject(new HostCognitionError(ServiceErrorCode.UNAVAILABLE));
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      let call: grpc.ClientUnaryCall;
      const abort = () => call?.cancel();
      call = this.client.makeUnaryRequest(`/${serviceName}/${name}`,
        value => Buffer.from(toBinary(input, value)), bytes => fromBinary(output, bytes), request,
        new grpc.Metadata(), { deadline: Date.now() + this.timeoutMs }, (error, result) => {
          this.inflight.delete(call);
          signal?.removeEventListener('abort', abort);
          if (!error) { resolve(result!); return; }
          let code = error.code === grpc.status.CANCELLED ? ServiceErrorCode.CANCELLED
            : error.code === grpc.status.DEADLINE_EXCEEDED ? ServiceErrorCode.DEADLINE_EXCEEDED : ServiceErrorCode.UNAVAILABLE;
          const detail = error.metadata?.get('glimmer-error-bin')[0];
          if (detail instanceof Buffer) {
            try { code = fromBinary(ServiceErrorDetailSchema, detail).code; } catch { /* 保留安全的通用错误。 */ }
          }
          reject(new HostCognitionError(code));
        });
      this.inflight.add(call);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
}
