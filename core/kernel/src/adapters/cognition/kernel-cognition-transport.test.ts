import * as grpc from '@grpc/grpc-js';
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

describe('KernelCognitionTransport', () => {
  const transport = KernelCognitionTransport.instance;

  afterEach(async () => {
    await transport.stop();
  });

  it('validates supervised generation and deduplicates action callbacks', async () => {
    await transport.start();
    const generation = transport.prepareProcess();
    transport.expectProcess(12345);
    const handler = vi.fn(async () => undefined);
    transport.setActionHandler(handler);
    const client = new grpc.Client(transport.controlEndpoint.slice('grpc://'.length), grpc.credentials.createInsecure());
    const call = transport.makeCallMetadata({ traceId: 'trace-register', causationId: 'cause-1', correlationId: 'correlation-1' });

    const registration = await rawCall(client, registerMethod, create(RegisterCognitionRequestSchema, {
      call,
      endpoint: 'grpc://127.0.0.1:54321',
      processId: 54321n,
      supervisorProcessId: 12345n,
    }));
    expect(registration).toMatchObject({ accepted: true, generation });

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
