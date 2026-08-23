import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import { create, fromBinary, toBinary, type JsonObject } from '@bufbuild/protobuf';
import {
  ServiceErrorCode,
  ServiceRecoveryAction,
  ServiceErrorDetailSchema,
  type CallMetadata,
} from '@glimmer-cradle/contracts/glimmer/common/v1/service_contract_pb';
import {
  PublishActionRequestSchema,
  PublishActionResponseSchema,
  PublishLogRequestSchema,
  PublishLogResponseSchema,
  PublishStateRequestSchema,
  PublishStateResponseSchema,
  RegisterCognitionRequestSchema,
  RegisterCognitionResponseSchema,
} from '@glimmer-cradle/contracts/glimmer/kernel/v1/kernel_control_service_pb';
import {
  CancelPerceptionRequestSchema,
  CancelPerceptionResponseSchema,
  CognitionService,
  GetConversationHistoryRequestSchema,
  GetConversationHistoryResponseSchema,
  HeartbeatRequestSchema,
  HeartbeatResponseSchema,
  InitializeKnowledgeRequestSchema,
  PlanRequestSchema,
  PlanResponseSchema,
  GetReadinessRequestSchema,
  GetReadinessResponseSchema,
  ShutdownRequestSchema,
  ShutdownResponseSchema,
  SubmitPerceptionRequestSchema,
  SubmitPerceptionResponseSchema,
  SynthesizeRequestSchema,
  SynthesizeResponseSchema,
  InitializeKnowledgeResponseSchema,
  GetPerceptionOperationRequestSchema,
  GetPerceptionOperationResponseSchema,
} from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import type { ActionCommand } from '@glimmer-cradle/protocol';
import { EventBus } from '../../adapters/events/event-bus';
import { StateSyncEvent } from '../../domain/events';
import { EndpointRegistry } from '../../adapters/endpoints/endpoint-registry';
import { getLogger } from '../../adapters/observability/logger';
import { createTraceContext, withTrace } from '../../adapters/observability/trace-context';
import type { CognitionActionHandler, CognitionProcessBootstrap } from '../../ports/cognition-service-port';
import { RecoveryRequiredError } from '../../domain/errors';
import { serviceDefinition, unaryMethod } from './grpc-contract';

const logger = getLogger('kernel-cognition-transport');
const ERROR_DETAIL_KEY = 'glimmer-error-bin';

export interface CognitionCallOptions {
  readonly timeoutMs: number;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly causationId?: string;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

const kernelControlDefinition = serviceDefinition('glimmer.kernel.v1.KernelControlService', {
  RegisterCognition: [RegisterCognitionRequestSchema, RegisterCognitionResponseSchema],
  PublishState: [PublishStateRequestSchema, PublishStateResponseSchema],
  PublishLog: [PublishLogRequestSchema, PublishLogResponseSchema],
  PublishAction: [PublishActionRequestSchema, PublishActionResponseSchema],
});

const cognitionMethods = {
  SubmitPerception: unaryMethod('/glimmer.cognition.v1.CognitionService/SubmitPerception', SubmitPerceptionRequestSchema, SubmitPerceptionResponseSchema),
  CancelPerception: unaryMethod('/glimmer.cognition.v1.CognitionService/CancelPerception', CancelPerceptionRequestSchema, CancelPerceptionResponseSchema),
  GetPerceptionOperation: unaryMethod('/glimmer.cognition.v1.CognitionService/GetPerceptionOperation', GetPerceptionOperationRequestSchema, GetPerceptionOperationResponseSchema),
  InitializeKnowledge: unaryMethod('/glimmer.cognition.v1.CognitionService/InitializeKnowledge', InitializeKnowledgeRequestSchema, InitializeKnowledgeResponseSchema),
  Plan: unaryMethod('/glimmer.cognition.v1.CognitionService/Plan', PlanRequestSchema, PlanResponseSchema),
  Synthesize: unaryMethod('/glimmer.cognition.v1.CognitionService/Synthesize', SynthesizeRequestSchema, SynthesizeResponseSchema),
  GetConversationHistory: unaryMethod('/glimmer.cognition.v1.CognitionService/GetConversationHistory', GetConversationHistoryRequestSchema, GetConversationHistoryResponseSchema),
  Heartbeat: unaryMethod('/glimmer.cognition.v1.CognitionService/Heartbeat', HeartbeatRequestSchema, HeartbeatResponseSchema),
  GetReadiness: unaryMethod('/glimmer.cognition.v1.CognitionService/GetReadiness', GetReadinessRequestSchema, GetReadinessResponseSchema),
  Shutdown: unaryMethod('/glimmer.cognition.v1.CognitionService/Shutdown', ShutdownRequestSchema, ShutdownResponseSchema),
} as const;

export class CognitionTransportError extends Error {
  public constructor(
    message: string,
    public readonly code: ServiceErrorCode,
    public readonly retryable: boolean,
    public readonly traceId?: string,
    public readonly call?: CallMetadata,
    public readonly recoveryActions: readonly ServiceRecoveryAction[] = [],
    public readonly operationId?: string,
  ) {
    super(message);
    this.name = 'CognitionTransportError';
  }
}

export class KernelCognitionTransport {
  private static _instance: KernelCognitionTransport | null = null;
  private server: grpc.Server | null = null;
  private serverAddress: string | null = null;
  private client: grpc.Client | null = null;
  private expectedProcessId: number | null = null;
  private processGeneration: string | null = null;
  private registeredProcessId: number | null = null;
  private registrationNonce: string | null = null;
  private registrationSecret: Buffer | null = null;
  private registrationWaiters = new Set<(error?: Error) => void>();
  private actionHandler: CognitionActionHandler | null = null;
  private readonly completedCommands = new Set<string>();
  private readonly inFlightCommands = new Map<string, Promise<unknown>>();
  private readonly actionAbortControllers = new Set<AbortController>();
  private actionDeadlineMs = 30_000;

  public static get instance(): KernelCognitionTransport {
    KernelCognitionTransport._instance ??= new KernelCognitionTransport();
    return KernelCognitionTransport._instance;
  }

  private constructor() {}

  public get controlEndpoint(): string {
    if (!this.serverAddress) throw new Error('Kernel Cognition gRPC control 尚未启动');
    return `grpc://${this.serverAddress}`;
  }

  public get generation(): string {
    if (!this.processGeneration) throw new Error('Cognition 进程世代尚未分配');
    return this.processGeneration;
  }

  public get isRegistered(): boolean {
    return this.client !== null && this.registeredProcessId !== null;
  }

  public async start(): Promise<void> {
    if (this.serverAddress) return;
    const server = new grpc.Server();
    server.addService(kernelControlDefinition, {
      RegisterCognition: this.registerCognition.bind(this),
      PublishState: this.publishState.bind(this),
      PublishLog: this.publishLog.bind(this),
      PublishAction: this.publishAction.bind(this),
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, boundPort) => {
        if (error) reject(error);
        else resolve(boundPort);
      });
    });
    this.server = server;
    this.serverAddress = `127.0.0.1:${port}`;
    logger.info('Kernel Cognition gRPC control 已绑定动态回环端点');
  }

  public prepareProcess(): CognitionProcessBootstrap {
    this.invalidateClient();
    this.registrationSecret?.fill(0);
    const superseded = new CognitionTransportError(
      'Cognition 注册能力已被新世代替换',
      ServiceErrorCode.GENERATION_MISMATCH,
      false,
    );
    for (const waiter of this.registrationWaiters) waiter(superseded);
    this.registrationWaiters.clear();
    this.expectedProcessId = null;
    this.processGeneration = randomUUID();
    this.registrationNonce = randomUUID();
    this.registrationSecret = randomBytes(32);
    this.registeredProcessId = null;
    return {
      generation: this.processGeneration,
      kernelEndpoint: this.controlEndpoint,
      registrationNonce: this.registrationNonce,
      registrationSecret: this.registrationSecret.toString('base64url'),
    };
  }

  public expectProcess(processId: number): void {
    if (!this.processGeneration) throw new Error('必须先分配 Cognition 进程世代');
    this.expectedProcessId = processId;
  }

  public async invalidateProcess(processId?: number, reason?: Error): Promise<void> {
    if (processId !== undefined && this.registeredProcessId !== processId && this.expectedProcessId !== processId) return;
    this.invalidateClient();
    this.expectedProcessId = null;
    this.processGeneration = null;
    this.registeredProcessId = null;
    this.registrationNonce = null;
    this.registrationSecret?.fill(0);
    this.registrationSecret = null;
    if (reason) {
      for (const waiter of this.registrationWaiters) waiter(reason);
      this.registrationWaiters.clear();
    }
    await EndpointRegistry.instance.revoke('cognition-rpc');
  }

  public setActionHandler(handler: CognitionActionHandler | null): void {
    this.actionHandler = handler;
  }

  public configureActionDeadline(timeoutMs: number): void {
    this.actionDeadlineMs = Math.max(1, timeoutMs);
  }

  public waitForRegistration(timeoutMs: number): Promise<void> {
    if (this.isRegistered) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = (error?: Error) => {
        clearTimeout(timer);
        this.registrationWaiters.delete(waiter);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => waiter(new CognitionTransportError(
        `等待 Cognition gRPC 注册超时（${timeoutMs}ms）`,
        ServiceErrorCode.NOT_READY,
        true,
      )), timeoutMs);
      this.registrationWaiters.add(waiter);
    });
  }

  public makeCallMetadata(options: Omit<CognitionCallOptions, 'timeoutMs'> = {}): CallMetadata {
    return create(CallMetadataSchema, {
      traceId: options.traceId ?? createTraceContext().trace_id,
      spanId: options.spanId ?? '',
      causationId: options.causationId ?? '',
      correlationId: options.correlationId ?? options.traceId ?? '',
      generation: this.generation,
      idempotencyKey: options.idempotencyKey ?? '',
    });
  }

  public call<I, O>(
    method: grpc.MethodDefinition<I, O>,
    request: I,
    options: CognitionCallOptions,
  ): Promise<O> {
    const client = this.client;
    if (!client || !this.isRegistered) {
      return Promise.reject(new CognitionTransportError('Cognition gRPC 尚未注册', ServiceErrorCode.NOT_READY, true, options.traceId));
    }
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(options.signal.reason ?? new DOMException('请求已取消', 'AbortError'));
        return;
      }
      let grpcCall: grpc.ClientUnaryCall | undefined;
      const abort = () => grpcCall?.cancel();
      grpcCall = client.makeUnaryRequest(
        method.path,
        method.requestSerialize,
        method.responseDeserialize,
        request,
        new grpc.Metadata(),
        { deadline: Date.now() + options.timeoutMs },
        (error, response) => {
          options.signal?.removeEventListener('abort', abort);
          if (error) reject(parseServiceError(error, options.traceId));
          else resolve(response as O);
        },
      );
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  }

  public get methods(): typeof cognitionMethods {
    return cognitionMethods;
  }

  public async stop(): Promise<void> {
    for (const controller of this.actionAbortControllers) {
      controller.abort(new Error('Kernel Cognition transport 正在停止'));
    }
    this.actionAbortControllers.clear();
    await this.invalidateProcess();
    this.actionHandler = null;
    this.completedCommands.clear();
    this.inFlightCommands.clear();
    for (const waiter of this.registrationWaiters) waiter(new Error('Kernel Cognition gRPC control 已停止'));
    this.registrationWaiters.clear();
    if (this.server) {
      const server = this.server;
      await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
      this.server = null;
      this.serverAddress = null;
    }
  }

  private registerCognition(
    call: grpc.ServerUnaryCall<ReturnType<typeof create<typeof RegisterCognitionRequestSchema>>, ReturnType<typeof create<typeof RegisterCognitionResponseSchema>>>,
    callback: grpc.sendUnaryData<ReturnType<typeof create<typeof RegisterCognitionResponseSchema>>>,
  ): void {
    void this.handleServerCall(call, callback, async (request) => {
      try {
        this.assertCall(request.call);
      } catch (error) {
        if (error instanceof CognitionTransportError) {
          throw this.registrationFault(error.code, error.message, request.call);
        }
        throw this.registrationFault(ServiceErrorCode.INTERNAL, 'Cognition 注册校验失败', request.call);
      }
      const processId = Number(request.processId);
      const supervisorProcessId = Number(request.supervisorProcessId);
      const supervised = processId === this.expectedProcessId || supervisorProcessId === this.expectedProcessId;
      if (!Number.isSafeInteger(processId) || !Number.isSafeInteger(supervisorProcessId) || !supervised) {
        throw this.registrationFault(ServiceErrorCode.GENERATION_MISMATCH, 'Cognition 进程身份与受监督子进程不一致', request.call);
      }
      const endpoint = request.endpoint.trim();
      if (!/^grpc:\/\/127\.0\.0\.1:\d+$/.test(endpoint)) {
        throw this.registrationFault(ServiceErrorCode.INVALID_REQUEST, 'Cognition 端点必须是动态回环 gRPC 地址', request.call);
      }
      if (!this.registrationNonce || !this.registrationSecret || request.registrationNonce !== this.registrationNonce) {
        throw this.registrationFault(ServiceErrorCode.GENERATION_MISMATCH, 'Cognition 注册 challenge 已失效', request.call);
      }
      const expectedProof = createHmac('sha256', this.registrationSecret)
        .update(`${this.generation}\n${this.registrationNonce}\n${endpoint}\n${processId}\n${supervisorProcessId}`)
        .digest();
      const proof = Buffer.from(request.authProof);
      if (proof.length !== expectedProof.length || !timingSafeEqual(proof, expectedProof)) {
        throw this.registrationFault(ServiceErrorCode.GENERATION_MISMATCH, 'Cognition 进程认证失败', request.call);
      }
      this.invalidateClient();
      this.client = new grpc.Client(endpoint.slice('grpc://'.length), grpc.credentials.createInsecure());
      this.registeredProcessId = processId;
      this.registrationSecret.fill(0);
      this.registrationSecret = null;
      this.registrationNonce = null;
      await EndpointRegistry.instance.publish('cognition-rpc', endpoint);
      for (const waiter of this.registrationWaiters) waiter();
      this.registrationWaiters.clear();
      logger.info('Cognition gRPC Service 已注册', { process_id: this.registeredProcessId });
      return create(RegisterCognitionResponseSchema, { generation: this.generation, accepted: true });
    });
  }

  private publishState(call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>): void {
    void this.handleServerCall(call, callback, async (request) => {
      this.assertCall(request.call);
      const traceId = request.call?.traceId || createTraceContext().trace_id;
      await withTrace(traceId, () => EventBus.instance.publish(
        new StateSyncEvent({ state: structToObject(request.state) }, createTraceContext({ trace_id: traceId })),
      ));
      return this.commandResult(PublishStateResponseSchema, request.call, 'state_published');
    });
  }

  private publishLog(call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>): void {
    void this.handleServerCall(call, callback, async (request) => {
      this.assertCall(request.call);
      const level = ['debug', 'info', 'warn', 'error'].includes(request.level) ? request.level : 'info';
      logger.log(level, request.message, { ...structToObject(request.attributes), trace_id: request.call?.traceId, from: 'python-cognition' });
      return this.commandResult(PublishLogResponseSchema, request.call, 'log_published');
    });
  }

  private publishAction(call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>): void {
    const abortController = new AbortController();
    this.actionAbortControllers.add(abortController);
    let deadlineExpired = false;
    const deadline = setTimeout(() => {
      deadlineExpired = true;
      abortController.abort(new Error('Kernel action deadline 已到期'));
    }, this.actionDeadlineMs);
    call.once('cancelled', () => abortController.abort(new Error('Cognition 已取消 action 调用')));
    void this.handleServerCall(call, callback, async (request) => {
      this.assertCall(request.call);
      const traceId = request.call?.traceId || createTraceContext().trace_id;
      const key = request.call?.idempotencyKey || '';
      if (key && this.completedCommands.has(key)) {
        return this.commandResult(PublishActionResponseSchema, request.call, 'duplicate', true);
      }
      const existing = key ? this.inFlightCommands.get(key) : undefined;
      if (existing) {
        await existing;
        return this.commandResult(PublishActionResponseSchema, request.call, 'duplicate', true);
      }
      if (!this.actionHandler) throw serviceFault(ServiceErrorCode.NOT_READY, 'Kernel action handler 尚未就绪', true, request.call);
      const command = mapActionCommand(request, traceId);
      const operationId = key || traceId;
      const execution = withTrace(traceId, () => this.actionHandler!(command, abortController.signal, operationId));
      if (key) this.inFlightCommands.set(key, execution);
      try {
        const result = await execution;
        const sideEffectsCommitted = result?.status === 'completed';
        if (abortController.signal.aborted && !sideEffectsCommitted) {
          throw serviceFault(
            deadlineExpired ? ServiceErrorCode.DEADLINE_EXCEEDED : ServiceErrorCode.CANCELLED,
            deadlineExpired ? 'Kernel action deadline 已到期' : 'Cognition 已取消 action 调用',
            false,
            request.call,
          );
        }
        if (key) this.rememberCompleted(key);
        return this.commandResult(PublishActionResponseSchema, request.call, 'completed');
      } catch (error) {
        if (
          abortController.signal.aborted
          && !(error instanceof CognitionTransportError)
          && !(error instanceof RecoveryRequiredError)
        ) {
          throw serviceFault(
            deadlineExpired ? ServiceErrorCode.DEADLINE_EXCEEDED : ServiceErrorCode.CANCELLED,
            deadlineExpired ? 'Kernel action deadline 已到期' : 'Cognition 已取消 action 调用',
            false,
            request.call,
          );
        }
        if (error instanceof CognitionTransportError) throw error;
        logger.error('Kernel action handler 执行失败', {
          trace_id: traceId,
          error_kind: error instanceof Error ? error.name : 'unknown',
        });
        if (error instanceof RecoveryRequiredError) {
          throw serviceFault(
            ServiceErrorCode.RECOVERY_REQUIRED,
            'Kernel action 副作用终态不明，需要人工恢复',
            false,
            request.call,
            [ServiceRecoveryAction.CONFIRM_SIDE_EFFECT_STATE],
            error.operationId,
          );
        }
        throw serviceFault(ServiceErrorCode.INTERNAL, 'Kernel action 执行失败', false, request.call);
      } finally {
        if (key) this.inFlightCommands.delete(key);
      }
    }).finally(() => {
      clearTimeout(deadline);
      this.actionAbortControllers.delete(abortController);
    });
  }

  private assertCall(call: CallMetadata | undefined): void {
    if (!call || !call.traceId) throw serviceFault(ServiceErrorCode.INVALID_REQUEST, '缺少调用 trace metadata', false, call);
    if (!this.processGeneration || call.generation !== this.processGeneration) {
      throw serviceFault(ServiceErrorCode.GENERATION_MISMATCH, 'Cognition 调用世代已失效', false, call);
    }
  }

  private commandResult(schema: any, call: CallMetadata | undefined, status: string, duplicate = false) {
    return create(schema, { operationId: call?.idempotencyKey || call?.traceId || randomUUID(), status, duplicate });
  }

  private rememberCompleted(key: string): void {
    this.completedCommands.add(key);
    if (this.completedCommands.size > 2048) this.completedCommands.delete(this.completedCommands.values().next().value!);
  }

  private async handleServerCall<I, O>(
    call: grpc.ServerUnaryCall<I, O>,
    callback: grpc.sendUnaryData<O>,
    handler: (request: I) => Promise<O>,
  ): Promise<void> {
    try {
      callback(null, await handler(call.request));
    } catch (error) {
      callback(toServiceError(error), null);
    }
  }

  private invalidateClient(): void {
    this.client?.close();
    this.client = null;
    this.registeredProcessId = null;
  }

  private registrationFault(code: ServiceErrorCode, message: string, call?: CallMetadata): CognitionTransportError {
    this.registrationSecret?.fill(0);
    this.registrationSecret = null;
    this.registrationNonce = null;
    this.expectedProcessId = null;
    const error = serviceFault(code, message, false, call);
    for (const waiter of this.registrationWaiters) waiter(error);
    this.registrationWaiters.clear();
    return error;
  }
}

import { CallMetadataSchema } from '@glimmer-cradle/contracts/glimmer/common/v1/service_contract_pb';

function mapActionCommand(request: any, traceId: string): ActionCommand {
  const conversation = request.skillRequest?.conversation;
  return {
    trace_id: traceId,
    action_type: request.actionType,
    target: { scene_id: request.targetSceneId, channel_hint: request.channelHint || undefined },
    payload: {
      text: request.text || undefined,
      messages: request.messages?.map((message: any) => ({
        sequence: message.sequence,
        content_type: message.contentType,
        text: message.text,
        language: message.language || undefined,
      })),
      items: request.items?.map((item: any) => ({ type: item.type, uri: item.uri || undefined, mime_type: item.mimeType || undefined })),
      skill_request: request.skillRequest ? {
        original_goal: request.skillRequest.originalGoal,
        capability_kind: request.skillRequest.capabilityKind,
        confidence: request.skillRequest.confidence,
        reason: request.skillRequest.reason || undefined,
        planning_hint: request.skillRequest.planningHint || undefined,
        conversation: conversation ? {
          source_provider_id: conversation.sourceProviderId,
          scene_id: conversation.sceneId,
          conversation_id: conversation.conversationId,
          continuity_id: conversation.continuityId,
          thread_id: conversation.threadId,
          interaction_id: conversation.interactionId,
          recall_scope: conversation.recallScope,
          disclosure_scope: conversation.disclosureScope,
        } : undefined,
      } : undefined,
    },
    emotion_state: structToObject(request.emotionState),
  } as ActionCommand;
}

export function objectToStruct(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value)) as JsonObject
    : {};
}

export function structToObject(value: unknown): Record<string, unknown> {
  return objectToStruct(value);
}

function serviceFault(
  code: ServiceErrorCode,
  message: string,
  retryable: boolean,
  call?: CallMetadata,
  recoveryActions: readonly ServiceRecoveryAction[] = [],
  operationId?: string,
) {
  return new CognitionTransportError(
    message,
    code,
    retryable,
    call?.traceId,
    call,
    recoveryActions,
    operationId,
  );
}

function toServiceError(error: unknown): grpc.ServiceError {
  const fault = error instanceof CognitionTransportError
    ? error
    : error instanceof RecoveryRequiredError
      ? new CognitionTransportError(
        'Kernel action 副作用终态不明，需要人工恢复',
        ServiceErrorCode.RECOVERY_REQUIRED,
        false,
        undefined,
        undefined,
        [ServiceRecoveryAction.CONFIRM_SIDE_EFFECT_STATE],
        error.operationId,
      )
      : new CognitionTransportError('Kernel action 执行失败', ServiceErrorCode.INTERNAL, false);
  if (!(error instanceof CognitionTransportError)) {
    logger.error('Kernel action handler 返回未受控异常', {
      error_kind: error instanceof Error ? error.name : 'unknown',
    });
  }
  const metadata = new grpc.Metadata();
  metadata.set(ERROR_DETAIL_KEY, Buffer.from(toBinary(ServiceErrorDetailSchema, create(ServiceErrorDetailSchema, {
    code: fault.code,
    safeMessage: fault.message,
    retryable: fault.retryable,
    call: fault.call ?? (fault.traceId ? create(CallMetadataSchema, { traceId: fault.traceId }) : undefined),
    recoveryActions: [...fault.recoveryActions],
    operationId: fault.operationId ?? '',
  }))));
  return Object.assign(new Error(fault.message), {
    code: grpcStatusFor(fault.code),
    details: fault.message,
    metadata,
  }) as grpc.ServiceError;
}

function parseServiceError(error: grpc.ServiceError, traceId?: string): CognitionTransportError {
  const binary = error.metadata?.get(ERROR_DETAIL_KEY)[0];
  if (binary instanceof Buffer) {
    try {
      const detail = fromBinary(ServiceErrorDetailSchema, binary);
      return new CognitionTransportError(
        detail.safeMessage || 'Cognition Service 请求失败',
        detail.code,
        detail.retryable,
        detail.call?.traceId || traceId,
        detail.call,
        detail.recoveryActions,
        detail.operationId || undefined,
      );
    } catch {
      // 远端 detail 损坏时保留 gRPC 通用语义。
    }
  }
  const code = error.code === grpc.status.DEADLINE_EXCEEDED
    ? ServiceErrorCode.DEADLINE_EXCEEDED
    : error.code === grpc.status.CANCELLED
      ? ServiceErrorCode.CANCELLED
      : ServiceErrorCode.UNAVAILABLE;
  return new CognitionTransportError(
    code === ServiceErrorCode.CANCELLED ? 'Cognition Service 请求已取消' : 'Cognition Service 暂不可用',
    code,
    code === ServiceErrorCode.UNAVAILABLE,
    traceId,
  );
}

function grpcStatusFor(code: ServiceErrorCode): grpc.status {
  switch (code) {
    case ServiceErrorCode.INVALID_REQUEST: return grpc.status.INVALID_ARGUMENT;
    case ServiceErrorCode.NOT_READY: return grpc.status.FAILED_PRECONDITION;
    case ServiceErrorCode.GENERATION_MISMATCH: return grpc.status.PERMISSION_DENIED;
    case ServiceErrorCode.CANCELLED: return grpc.status.CANCELLED;
    case ServiceErrorCode.DEADLINE_EXCEEDED: return grpc.status.DEADLINE_EXCEEDED;
    case ServiceErrorCode.UNAVAILABLE: return grpc.status.UNAVAILABLE;
    case ServiceErrorCode.RECOVERY_REQUIRED: return grpc.status.FAILED_PRECONDITION;
    default: return grpc.status.INTERNAL;
  }
}

export { CognitionService };
