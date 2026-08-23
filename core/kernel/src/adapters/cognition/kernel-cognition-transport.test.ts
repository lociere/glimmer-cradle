import * as grpc from '@grpc/grpc-js';
import { createHmac } from 'node:crypto';
import { create } from '@bufbuild/protobuf';
import {
  PublishActionRequestSchema,
  PublishActionResponseSchema,
  RegisterCognitionRequestSchema,
  RegisterCognitionResponseSchema,
} from '@glimmer-cradle/contracts/glimmer/kernel/v1/kernel_control_service_pb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unaryMethod } from './grpc-contract';
import { KernelCognitionTransport } from './kernel-cognition-transport';

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
  const transport = KernelCognitionTransport.instance;

  afterEach(async () => {
    await transport.stop();
  });

  it('validates supervised generation and deduplicates action callbacks', async () => {
    await transport.start();
    const bootstrap = transport.prepareProcess();
    transport.expectProcess(12345);
    const handler = vi.fn(async () => undefined);
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
      call: transport.makeCallMetadata({ traceId: 'trace-action', idempotencyKey: 'action-1' }),
      actionType: 'reply',
      targetSceneId: 'scene-1',
      text: 'hello',
    });
    const first = await rawCall(client, actionMethod, action);
    const second = await rawCall(client, actionMethod, action);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

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
    transport.setActionHandler(async (_command, signal) => {
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
    transport.setActionHandler(async (_command, signal) => {
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
