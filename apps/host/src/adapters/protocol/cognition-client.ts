import { randomUUID } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import { create, fromBinary, toBinary, type DescMessage, type MessageShape } from '@bufbuild/protobuf';
import { CallMetadataSchema, ServiceErrorDetailSchema, ServiceErrorCode } from '@glimmer-cradle/contracts/glimmer/common/v1/service_contract_pb';
import {
  ExecuteMemoryJobRequestSchema, ExecuteMemoryJobResponseSchema,
  ReconcileMemoryJobRequestSchema, ReconcileMemoryJobResponseSchema,
  ReadMemoryJobRequestsRequestSchema, ReadMemoryJobRequestsResponseSchema,
  AcknowledgeMemoryJobRequestRequestSchema, AcknowledgeMemoryJobRequestResponseSchema,
  GetReadinessRequestSchema, GetReadinessResponseSchema, ShutdownRequestSchema, ShutdownResponseSchema,
  PublishMemoryJobStateRequestSchema, PublishMemoryJobStateResponseSchema,
  type PublishMemoryJobStateRequest, type PublishMemoryJobStateResponse,
  type ExecuteMemoryJobRequest, type ExecuteMemoryJobResponse,
  type ReconcileMemoryJobRequest, type ReconcileMemoryJobResponse,
  type ReadMemoryJobRequestsRequest, type ReadMemoryJobRequestsResponse,
  type AcknowledgeMemoryJobRequestRequest, type AcknowledgeMemoryJobRequestResponse,
} from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';

export interface MemoryJobsCognitionPort {
  execute(request: ExecuteMemoryJobRequest, signal?: AbortSignal): Promise<ExecuteMemoryJobResponse>;
  reconcile(request: ReconcileMemoryJobRequest, signal?: AbortSignal): Promise<ReconcileMemoryJobResponse>;
  readRequests(request: ReadMemoryJobRequestsRequest, signal?: AbortSignal): Promise<ReadMemoryJobRequestsResponse>;
  acknowledge(request: AcknowledgeMemoryJobRequestRequest, signal?: AbortSignal): Promise<AcknowledgeMemoryJobRequestResponse>;
  publishJobState(request: PublishMemoryJobStateRequest, signal?: AbortSignal): Promise<PublishMemoryJobStateResponse>;
}

export class HostCognitionError extends Error {
  public constructor(public readonly code: ServiceErrorCode) { super('受监督 Cognition Service 请求失败'); }
}

/** 端点及 generation 由监督 owner 注入；切代必须撤销旧 client，不自造或发现 authority。 */
export class CognitionClient implements MemoryJobsCognitionPort {
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
  public readiness(signal?: AbortSignal) {
    return this.call('GetReadiness', GetReadinessRequestSchema, GetReadinessResponseSchema,
      create(GetReadinessRequestSchema, { call: this.metadata() }), signal);
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
    request: MessageShape<I>, signal?: AbortSignal): Promise<MessageShape<O>> {
    if (this.closed) return Promise.reject(new HostCognitionError(ServiceErrorCode.UNAVAILABLE));
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      let call: grpc.ClientUnaryCall;
      const abort = () => call?.cancel();
      call = this.client.makeUnaryRequest(`/glimmer.cognition.v1.CognitionService/${name}`,
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
