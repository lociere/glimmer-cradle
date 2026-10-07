import * as grpc from '@grpc/grpc-js';
import { createHmac } from 'node:crypto';
import { create, fromBinary } from '@bufbuild/protobuf';
import { ExposeStepRequestSchema, ExposeStepResponseSchema, InvokeToolRequestSchema, InvokeToolResponseSchema } from '@glimmer-cradle/contracts/glimmer/capabilities/v1/capabilities_pb';
import { NativeCapabilityRequestError } from '../../ports/native-capability-service.port';
import type { NativeToolInvocation, NativeToolResult } from '../../ports/native-capability-service.port';
import {
  ServiceErrorCode,
  ServiceErrorDetailSchema,
  ServiceRecoveryAction,
} from '@glimmer-cradle/contracts/glimmer/common/v1/service_contract_pb';
import {
  PublishActionRequestSchema,
  PublishActionResponseSchema,
  RegisterCognitionRequestSchema,
  RegisterCognitionResponseSchema,
} from '@glimmer-cradle/contracts/glimmer/kernel/v1/kernel_control_service_pb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unaryMethod } from './grpc-contract';
import { KernelCognitionTransport } from './kernel-cognition-transport';
import { RecoveryRequiredError } from '../../domain/errors';
import type { ActionCommand } from '../../ports/application-models';

const registerMethod = unaryMethod(
  '/glimmer.kernel.v1.KernelControlService/RegisterCognition',
  RegisterCognitionRequestSchema,
  RegisterCognitionResponseSchema,
);
const actionMethod = unaryMethod(
  '/glimmer.kernel.v1.KernelControlService/PublishAction',
  PublishActionRequestSchema,
  PublishActionResponseSchema,
);

function rawCall<I, O>(client: grpc.Client, method: grpc.MethodDefinition<I, O>, request: I): Promise<O> {
  return new Promise((resolve, reject) => {
    client.makeUnaryRequest(
      method.path,
      method.requestSerialize,
      method.responseDeserialize,
      request,
      (error, response) => error ? reject(error) : resolve(response as O),
    );
  });
}

function cancellableRawCall<I, O>(client: grpc.Client, method: grpc.MethodDefinition<I, O>, request: I) {
  let call!: grpc.ClientUnaryCall;
  const promise = new Promise<O>((resolve, reject) => {
    call = client.makeUnaryRequest(
      method.path, method.requestSerialize, method.responseDeserialize, request,
      (error, response) => error ? reject(error) : resolve(response as O),
    );
  });
  return { call, promise };
}

describe('KernelCognitionTransport', () => {
  const transport = new KernelCognitionTransport();

  afterEach(async () => {
    await transport.stop();
    transport.configureActionDeadline(30_000);
  });

  it.each(['deadline', 'cancel', 'generation', 'replacement'] as const)('native %s 取消实际等待且不冒充成功', async failure => {
    await transport.start(); const client = await registerTransport(transport, 781);
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    let aborted = false;
    transport.setCapabilityService({ exposeStep: () => { throw new Error('not used'); }, revokePrincipal: vi.fn(),
      invokeTool: async (_request, _trace, signal) => {
        entered();
        await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true }));
        throw new Error('must not complete');
      } });
    transport.configureActionDeadline(failure === 'deadline' ? 25 : 30_000);
    const method = unaryMethod('/glimmer.capabilities.v1.CapabilityService/InvokeTool', InvokeToolRequestSchema, InvokeToolResponseSchema);
    const pending = cancellableRawCall(client, method, create(InvokeToolRequestSchema, {
      call: transport.makeCallMetadata({ traceId: 'native-cancel', idempotencyKey: 'run:call' }), runId: 'run', step: 1, callId: 'call', name: 'tool',
      reference: { id: 'id', revision: 'revision' }, sourceFactId: 'actual-action', scope: { sourceProviderId: 'provider', sceneId: 'scene', conversationId: 'conversation' } }));
    const rejected = expect(pending.promise).rejects.toMatchObject({ code: failure === 'deadline' ? grpc.status.DEADLINE_EXCEEDED : grpc.status.CANCELLED });
    try {
      await started;
      if (failure === 'cancel') pending.call.cancel();
      if (failure === 'generation') await transport.invalidateProcess();
      if (failure === 'replacement') transport.prepareProcess();
      await rejected;
      // Client cancellation can arrive before the server has processed its cancel event.
      await vi.waitFor(() => expect(aborted).toBe(true));
    } finally { client.close(); }
  });

  it('typed Capability RPC 绑定监督主体、真实 scope/ref 和结果事件，拒绝旧 generation', async () => {
    await transport.start(); const client = await registerTransport(transport, 779);
    const expose = unaryMethod('/glimmer.capabilities.v1.CapabilityService/ExposeStep', ExposeStepRequestSchema, ExposeStepResponseSchema);
    const invoke = unaryMethod('/glimmer.capabilities.v1.CapabilityService/InvokeTool', InvokeToolRequestSchema, InvokeToolResponseSchema);
    const exposeStep = vi.fn(request => ({ run_id: request.run_id, step: request.step, tools: [{ reference: { id: 'id', revision: 'revision' }, name: 'tool', description: '天气', input_schema: true }], skills: [], resources: [], used_definition_bytes: 123, truncated: false }));
    const invokeTool = vi.fn(async (request: NativeToolInvocation): Promise<NativeToolResult> => ({ call_id: request.call_id, name: request.name, state: 'succeeded', result: null, result_event_id: 'a'.repeat(64) }));
    const revokePrincipal = vi.fn(); transport.setCapabilityService({ exposeStep, invokeTool, revokePrincipal });
    const scope = { sourceProviderId: 'provider', sceneId: 'scene', conversationId: 'conversation', userId: 'user' };
    try {
      const surface = await rawCall(client, expose, create(ExposeStepRequestSchema, { call: transport.makeCallMetadata({ traceId: 'native' }),
        runId: 'run', step: 1, scope, protocolFeatures: ['tool-call.v1'], maxDefinitions: 128, maxDefinitionBytes: 65536, remainingToolCalls: 1 }));
      expect(surface.tools[0]!.reference).toMatchObject({ id: 'id', revision: 'revision' });
      expect(exposeStep.mock.calls[0]![0]).toMatchObject({ principal_id: `cognition:${transport.generation}`, user_id: 'user',
        scope: { conversation_id: 'conversation', source_provider_id: 'provider', scene_id: 'scene', user_id: 'user' } });
      const request = create(InvokeToolRequestSchema, { call: transport.makeCallMetadata({ traceId: 'native', idempotencyKey: 'run:call' }),
        runId: 'run', step: 1, callId: 'call', name: 'tool', reference: { id: 'id', revision: 'revision' }, scope, sourceFactId: 'actual-action' });
      const result = await rawCall(client, invoke, request);
      expect(result.resultEventId).toBe('a'.repeat(64)); expect(result.result?.kind.case).toBe('nullValue');
      expect(invokeTool.mock.calls[0]![0]).toMatchObject({ invocation_id: 'run:call', source_fact_id: 'actual-action', reference: { id: 'id', revision: 'revision' } });
      invokeTool.mockResolvedValueOnce({ call_id: 'call', name: 'tool', state: 'failed', error: 'authorization_denied', result_event_id: 'b'.repeat(64) });
      const denied = await rawCall(client, invoke, request);
      expect(denied.error).toBe('authorization_denied'); expect(denied.result).toBeUndefined();
      invokeTool.mockRejectedValueOnce(new NativeCapabilityRequestError('private diagnostic'));
      await expect(rawCall(client, invoke, request)).rejects.toMatchObject({ code: grpc.status.INVALID_ARGUMENT });
      const oldGeneration = transport.generation; transport.prepareProcess();
      expect(revokePrincipal).toHaveBeenCalledWith(`cognition:${oldGeneration}`);
      await expect(rawCall(client, invoke, request)).rejects.toMatchObject({ code: grpc.status.PERMISSION_DENIED });
    } finally { client.close(); }
  });

  it('validates supervised generation and deduplicates action callbacks', async () => {
    await transport.start();
    const bootstrap = transport.prepareProcess();
    transport.expectProcess(12345);
    const handler = vi.fn(async (_command: ActionCommand) => undefined);
    transport.setActionHandler(handler);
    const client = new grpc.Client(transport.controlEndpoint.slice('grpc://'.length), grpc.credentials.createInsecure());
    const call = transport.makeCallMetadata({ traceId: 'trace-register', causationId: 'cause-1', correlationId: 'correlation-1' });

    const endpoint = 'grpc://127.0.0.1:54321';
    const proof = createHmac('sha256', Buffer.from(bootstrap.registrationSecret, 'base64url'))
      .update(`${bootstrap.generation}\n${bootstrap.registrationNonce}\n${endpoint}\n12345\n0`)
      .digest();
    const registration = await rawCall(client, registerMethod, create(RegisterCognitionRequestSchema, {
      call,
      endpoint,
      processId: 12345n,
      supervisorProcessId: 0n,
      registrationNonce: bootstrap.registrationNonce,
      authProof: proof,
    }));
    expect(registration).toMatchObject({ accepted: true, generation: bootstrap.generation });

    const action = create(PublishActionRequestSchema, {
      call: transport.makeCallMetadata({ traceId: 'trace-action', idempotencyKey: 'action-1', causationId: 'original-action-fact' }),
      actionType: 'reply',
      targetSceneId: 'scene-1',
      text: 'hello',
    });
    const first = await rawCall(client, actionMethod, action);
    const second = await rawCall(client, actionMethod, action);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].source_fact_id).toBe('original-action-fact');

    action.call!.generation = 'stale-generation';
    await expect(rawCall(client, actionMethod, action)).rejects.toMatchObject({ code: grpc.status.PERMISSION_DENIED });
    client.close();
  });

  it('rejects a process that only knows the generation and reported PID', async () => {
    await transport.start();
    const bootstrap = transport.prepareProcess();
    transport.expectProcess(321);
    const client = new grpc.Client(transport.controlEndpoint.slice('grpc://'.length), grpc.credentials.createInsecure());
    await expect(rawCall(client, registerMethod, create(RegisterCognitionRequestSchema, {
      call: transport.makeCallMetadata({ traceId: 'impersonation' }),
      endpoint: 'grpc://127.0.0.1:43210',
      processId: 321n,
      supervisorProcessId: 0n,
      registrationNonce: bootstrap.registrationNonce,
      authProof: new Uint8Array(32),
    }))).rejects.toMatchObject({ code: grpc.status.PERMISSION_DENIED });
    expect((transport as unknown as { registrationSecret: Buffer | null }).registrationSecret).toBeNull();
    expect((transport as unknown as { registrationNonce: string | null }).registrationNonce).toBeNull();
    const endpoint = 'grpc://127.0.0.1:43210';
    const validProofAfterFailure = createHmac('sha256', Buffer.from(bootstrap.registrationSecret, 'base64url'))
      .update(`${bootstrap.generation}\n${bootstrap.registrationNonce}\n${endpoint}\n321\n0`)
      .digest();
    await expect(rawCall(client, registerMethod, create(RegisterCognitionRequestSchema, {
      call: transport.makeCallMetadata({ traceId: 'capability-must-be-invalidated' }),
      endpoint,
      processId: 321n,
      supervisorProcessId: 0n,
      registrationNonce: bootstrap.registrationNonce,
      authProof: validProofAfterFailure,
    }))).rejects.toMatchObject({ code: grpc.status.PERMISSION_DENIED });
    client.close();
  });

  it('zeros the previous FD3 capability before preparing a new process generation', async () => {
    await transport.start();
    const first = transport.prepareProcess();
    const oldSecret = (transport as unknown as { registrationSecret: Buffer }).registrationSecret;
    const second = transport.prepareProcess();

    expect(oldSecret.every((value) => value === 0)).toBe(true);
    expect(second.generation).not.toBe(first.generation);
    expect(second.registrationNonce).not.toBe(first.registrationNonce);
    expect(second.registrationSecret).not.toBe(first.registrationSecret);
    transport.expectProcess(654);
    const endpoint = 'grpc://127.0.0.1:45654';
    const staleProof = createHmac('sha256', Buffer.from(first.registrationSecret, 'base64url'))
      .update(`${first.generation}\n${first.registrationNonce}\n${endpoint}\n654\n0`)
      .digest();
    const client = new grpc.Client(transport.controlEndpoint.slice('grpc://'.length), grpc.credentials.createInsecure());
    await expect(rawCall(client, registerMethod, create(RegisterCognitionRequestSchema, {
      call: transport.makeCallMetadata({ traceId: 'stale-fd3-capability' }),
      endpoint,
      processId: 654n,
      supervisorProcessId: 0n,
      registrationNonce: first.registrationNonce,
      authProof: staleProof,
    }))).rejects.toMatchObject({ code: grpc.status.PERMISSION_DENIED });
    client.close();
  });

  it('retries failed idempotent actions only after the failed side effect is released', async () => {
    await transport.start();
    const client = await registerTransport(transport, 777);
    const handler = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue(undefined);
    transport.setActionHandler(handler);
    const action = create(PublishActionRequestSchema, {
      call: transport.makeCallMetadata({ traceId: 'retry-action', idempotencyKey: 'retry-key' }),
      actionType: 'reply', targetSceneId: 'scene-1', text: 'retry',
    });
    await expect(rawCall(client, actionMethod, action)).rejects.toMatchObject({ code: grpc.status.INTERNAL });
    expect((await rawCall(client, actionMethod, action)).status).toBe('completed');
    expect(handler).toHaveBeenCalledTimes(2);
    client.close();
  });

  it('coalesces concurrent action attempts and commits idempotency after one success', async () => {
    await transport.start();
    const client = await registerTransport(transport, 780);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const handler = vi.fn(async () => gate);
    transport.setActionHandler(handler);
    const action = create(PublishActionRequestSchema, {
      call: transport.makeCallMetadata({ traceId: 'concurrent-action', idempotencyKey: 'concurrent-key' }),
      actionType: 'reply', targetSceneId: 'scene-1', text: 'concurrent',
    });
    const first = rawCall(client, actionMethod, action);
    const second = rawCall(client, actionMethod, action);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    release();
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.status).sort()).toEqual(['completed', 'duplicate']);
    expect(handler).toHaveBeenCalledTimes(1);
    client.close();
  });

  it('owns the reverse action deadline and aborts cooperative side effects', async () => {
    await transport.start();
    const client = await registerTransport(transport, 778);
    transport.configureActionDeadline(25);
    let aborted = false;
    let sideEffect = false;
    transport.setActionHandler(async (_command: ActionCommand, signal: AbortSignal) => {
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => {
        aborted = true;
        reject(signal.reason);
      }, { once: true }));
      sideEffect = true;
    });
    const action = create(PublishActionRequestSchema, {
      call: transport.makeCallMetadata({ traceId: 'deadline-action', idempotencyKey: 'deadline-key' }),
      actionType: 'reply', targetSceneId: 'scene-1', text: 'deadline',
    });
    await expect(rawCall(client, actionMethod, action)).rejects.toMatchObject({ code: grpc.status.DEADLINE_EXCEEDED });
    expect(aborted).toBe(true);
    expect(sideEffect).toBe(false);
    client.close();
  });

  it('propagates reverse RPC cancellation before the action side effect commits', async () => {
    await transport.start();
    const client = await registerTransport(transport, 779);
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    let aborted = false;
    let sideEffect = false;
    transport.setActionHandler(async (_command: ActionCommand, signal: AbortSignal) => {
      started();
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => {
        aborted = true;
        reject(signal.reason);
      }, { once: true }));
      sideEffect = true;
    });
    const pending = cancellableRawCall(client, actionMethod, create(PublishActionRequestSchema, {
      call: transport.makeCallMetadata({ traceId: 'cancel-action', idempotencyKey: 'cancel-key' }),
      actionType: 'reply', targetSceneId: 'scene-1', text: 'cancel',
    }));
    await entered;
    pending.call.cancel();
    await expect(pending.promise).rejects.toMatchObject({ code: grpc.status.CANCELLED });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(aborted).toBe(true);
    expect(sideEffect).toBe(false);
    client.close();
  });

  it('commits transport idempotency when the handler journal confirms a post-deadline side effect', async () => {
    await transport.start();
    const client = await registerTransport(transport, 781);
    transport.configureActionDeadline(10);
    const handler = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { status: 'completed' as const };
    });
    transport.setActionHandler(handler);
    const action = create(PublishActionRequestSchema, {
      call: transport.makeCallMetadata({ traceId: 'post-commit', idempotencyKey: 'post-commit-key' }),
      actionType: 'reply', targetSceneId: 'scene-1', text: 'committed',
    });

    expect((await rawCall(client, actionMethod, action)).status).toBe('completed');
    expect((await rawCall(client, actionMethod, action)).duplicate).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    client.close();
  });

  it('returns a safe typed action failure and preserves complete call metadata', async () => {
    await transport.start();
    const client = await registerTransport(transport, 782);
    transport.setActionHandler(async () => { throw new Error('private provider token and stack'); });
    const call = transport.makeCallMetadata({
      traceId: 'safe-trace', spanId: 'safe-span', causationId: 'safe-cause',
      correlationId: 'safe-correlation', idempotencyKey: 'safe-key',
    });
    const action = create(PublishActionRequestSchema, {
      call, actionType: 'reply', targetSceneId: 'scene-1', text: 'fail',
    });

    let error!: grpc.ServiceError;
    try {
      await rawCall(client, actionMethod, action);
      throw new Error('expected PublishAction to fail');
    } catch (caught) {
      error = caught as grpc.ServiceError;
    }
    expect(error.details).toBe('Kernel action 执行失败');
    expect(error.details).not.toContain('private provider token');
    const binary = error.metadata.get('glimmer-error-bin')[0];
    expect(binary).toBeInstanceOf(Buffer);
    const detail = fromBinary(ServiceErrorDetailSchema, binary as Buffer);
    expect(detail.call).toMatchObject({
      traceId: 'safe-trace', spanId: 'safe-span', causationId: 'safe-cause',
      correlationId: 'safe-correlation', idempotencyKey: 'safe-key',
      generation: call.generation,
    });
    client.close();
  });

  it('projects manual recovery as a stable Service terminal across repeated requests', async () => {
    await transport.start();
    const client = await registerTransport(transport, 783);
    const handler = vi.fn(async () => {
      throw new RecoveryRequiredError('action:unsafe:tool:0');
    });
    transport.setActionHandler(handler);
    const call = transport.makeCallMetadata({
      traceId: 'recovery-trace',
      spanId: 'recovery-span',
      causationId: 'recovery-cause',
      correlationId: 'recovery-correlation',
      idempotencyKey: 'action:unsafe',
    });
    const action = create(PublishActionRequestSchema, {
      call,
      actionType: 'skill_request', targetSceneId: 'scene-1', text: 'unsafe',
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let error!: grpc.ServiceError;
      try {
        await rawCall(client, actionMethod, action);
        throw new Error('expected recovery-required failure');
      } catch (caught) {
        error = caught as grpc.ServiceError;
      }
      expect(error.code).toBe(grpc.status.FAILED_PRECONDITION);
      const detail = fromBinary(ServiceErrorDetailSchema, error.metadata.get('glimmer-error-bin')[0] as Buffer);
      expect(detail).toMatchObject({
        code: ServiceErrorCode.RECOVERY_REQUIRED,
        retryable: false,
        operationId: 'action:unsafe:tool:0',
        recoveryActions: [ServiceRecoveryAction.CONFIRM_SIDE_EFFECT_STATE],
        call: {
          traceId: 'recovery-trace',
          spanId: 'recovery-span',
          causationId: 'recovery-cause',
          correlationId: 'recovery-correlation',
          generation: call.generation,
          idempotencyKey: 'action:unsafe',
        },
      });
    }
    expect(handler).toHaveBeenCalledTimes(2);
    client.close();
  });

  it('can bind a new dynamic endpoint after lifecycle stop', async () => {
    await transport.start();
    const first = transport.controlEndpoint;
    await transport.stop();
    await transport.start();
    const second = transport.controlEndpoint;
    expect(second).toMatch(/^grpc:\/\/127\.0\.0\.1:\d+$/);
    expect(transport.controlEndpoint).not.toBe('');
    expect(first).toMatch(/^grpc:\/\/127\.0\.0\.1:\d+$/);
  });
});

async function registerTransport(transport: KernelCognitionTransport, processId: number): Promise<grpc.Client> {
  const bootstrap = transport.prepareProcess();
  transport.expectProcess(processId);
  const endpoint = `grpc://127.0.0.1:${40000 + processId % 1000}`;
  const proof = createHmac('sha256', Buffer.from(bootstrap.registrationSecret, 'base64url'))
    .update(`${bootstrap.generation}\n${bootstrap.registrationNonce}\n${endpoint}\n${processId}\n0`)
    .digest();
  const client = new grpc.Client(transport.controlEndpoint.slice('grpc://'.length), grpc.credentials.createInsecure());
  await rawCall(client, registerMethod, create(RegisterCognitionRequestSchema, {
    call: transport.makeCallMetadata({ traceId: `register-${processId}` }), endpoint,
    processId: BigInt(processId), registrationNonce: bootstrap.registrationNonce, authProof: proof,
    supervisorProcessId: 0n,
  }));
  return client;
}
