import { EventEmitter } from 'node:events';
import * as grpc from '@grpc/grpc-js';
import { create, fromBinary, toBinary, type DescMessage, type MessageShape } from '@bufbuild/protobuf';
import {
  CallMetadataSchema,
} from '@glimmer-cradle/contracts/glimmer/common/v1/service_contract_pb';
import {
  SurfaceGatewayServiceCommandRequestSchema,
  SurfaceGatewayServiceCommandResponseSchema,
  SurfaceGatewayServiceConnectRequestSchema,
  SurfaceGatewayServiceConnectResponseSchema,
  SurfaceGatewayServiceQueryRequestSchema,
  SurfaceGatewayServiceQueryResponseSchema,
  SurfaceGatewayServiceStreamResponseSchema,
  SurfaceGatewayServiceStreamRequestSchema,
  type SurfaceGatewayServiceCommandRequest,
  type SurfaceGatewayServiceCommandResponse,
  type SurfaceGatewayServiceConnectRequest,
  type SurfaceGatewayServiceConnectResponse,
  type SurfaceGatewayServiceQueryRequest,
  type SurfaceGatewayServiceQueryResponse,
  type SurfaceGatewayServiceStreamResponse,
  type SurfaceEvent,
} from '@glimmer-cradle/contracts/glimmer/surface/v1/surface_gateway_pb';
import {
  commandFromSurfaceRequest,
  queryFromSurfaceRequest,
  surfaceEventToProjection,
  type ProductSurfaceProjection,
  type ProductSurfaceRequest,
} from './surface-grpc-mapper';

const OPEN = 1;
const CONNECTING = 0;
const CLOSED = 3;
export const SURFACE_GATEWAY_OPEN = OPEN;
export const SURFACE_GATEWAY_CONNECTING = CONNECTING;

type SurfaceGrpcClient = grpc.Client & {
  Connect(request: SurfaceGatewayServiceConnectRequest, callback: (error: grpc.ServiceError | null, response: SurfaceGatewayServiceConnectResponse) => void): void;
  Query(request: SurfaceGatewayServiceQueryRequest, callback: (error: grpc.ServiceError | null, response: SurfaceGatewayServiceQueryResponse) => void): void;
  Command(request: SurfaceGatewayServiceCommandRequest, callback: (error: grpc.ServiceError | null, response: SurfaceGatewayServiceCommandResponse) => void): void;
  Stream(request: unknown): grpc.ClientReadableStream<SurfaceGatewayServiceStreamResponse>;
};

function unaryMethod<I extends DescMessage, O extends DescMessage>(
  path: string,
  input: I,
  output: O,
): grpc.MethodDefinition<MessageShape<I>, MessageShape<O>> {
  return {
    path,
    requestStream: false,
    responseStream: false,
    requestSerialize: (value) => Buffer.from(toBinary(input, value)),
    requestDeserialize: (value) => fromBinary(input, value),
    responseSerialize: (value) => Buffer.from(toBinary(output, value)),
    responseDeserialize: (value) => fromBinary(output, value),
  };
}

function serverStreamingMethod<I extends DescMessage, O extends DescMessage>(
  path: string,
  input: I,
  output: O,
): grpc.MethodDefinition<MessageShape<I>, MessageShape<O>> {
  return {
    ...unaryMethod(path, input, output),
    responseStream: true,
  };
}

const surfaceDefinition: grpc.ServiceDefinition = {
  Connect: unaryMethod('/glimmer.surface.v1.SurfaceGatewayService/Connect', SurfaceGatewayServiceConnectRequestSchema, SurfaceGatewayServiceConnectResponseSchema),
  Query: unaryMethod('/glimmer.surface.v1.SurfaceGatewayService/Query', SurfaceGatewayServiceQueryRequestSchema, SurfaceGatewayServiceQueryResponseSchema),
  Command: unaryMethod('/glimmer.surface.v1.SurfaceGatewayService/Command', SurfaceGatewayServiceCommandRequestSchema, SurfaceGatewayServiceCommandResponseSchema),
  Stream: serverStreamingMethod('/glimmer.surface.v1.SurfaceGatewayService/Stream', SurfaceGatewayServiceStreamRequestSchema, SurfaceGatewayServiceStreamResponseSchema),
};

const ClientConstructor = grpc.makeGenericClientConstructor(surfaceDefinition, 'SurfaceGatewayService') as unknown as {
  new(address: string, credentials: grpc.ChannelCredentials): SurfaceGrpcClient;
};

export class SurfaceGatewayClient extends EventEmitter {
  private client: SurfaceGrpcClient | null = null;
  private stream: grpc.ClientReadableStream<SurfaceGatewayServiceStreamResponse> | null = null;
  private sessionId = '';
  private stopped = false;
  private _readyState = CLOSED;

  public constructor() {
    super();
  }

  public get readyState(): number {
    return this._readyState;
  }

  public async connect(endpoint: string, generation: string): Promise<void> {
    this.stopped = false;
    this._readyState = CONNECTING;
    const target = endpoint.replace(/^grpc:\/\//u, '');
    const client = new ClientConstructor(target, grpc.credentials.createInsecure());
    this.client = client;
    const response = await new Promise<SurfaceGatewayServiceConnectResponse>((resolve, reject) => {
      client.Connect(create(SurfaceGatewayServiceConnectRequestSchema, {
        productId: 'desktop',
        generation,
        scopes: ['surface:read', 'surface:write'],
        call: create(CallMetadataSchema, { traceId: `desktop-surface-${Date.now()}` }),
      }), (error, result) => error ? reject(error) : resolve(result));
    });
    if (!response.accepted || !response.sessionId) {
      throw new Error(response.message || 'Surface Gateway Connect rejected');
    }
    this.sessionId = response.sessionId;
    const stream = client.Stream(create(SurfaceGatewayServiceStreamRequestSchema, {
      sessionId: this.sessionId,
      call: create(CallMetadataSchema, { traceId: `desktop-surface-stream-${Date.now()}` }),
    }));
    this.stream = stream;
    stream.on('data', (event) => this.emitProjection(event));
    stream.once('end', () => this.disconnect(false));
    stream.once('error', (error) => this.fail(error));
    this._readyState = OPEN;
    this.emit('open');
  }

  public submit(frame: ProductSurfaceRequest): void {
    if (this._readyState !== OPEN || !this.client || !this.sessionId) return;
    const call = create(CallMetadataSchema, {
      traceId: frame.trace_id ?? `desktop-surface-${Date.now()}`,
      idempotencyKey: 'request_id' in frame ? frame.request_id : '',
    });
    const query = queryFromSurfaceRequest(frame);
    if (query) {
      this.client.Query(create(SurfaceGatewayServiceQueryRequestSchema, {
        sessionId: this.sessionId,
        call,
        query,
      }), (error, response) => this.handleResponse(error, response?.event));
      return;
    }
    const command = commandFromSurfaceRequest(frame);
    if (!command) {
      this.emit('error', new Error(`Surface 请求类型不受支持：${frame.kind}`));
      return;
    }
    this.client.Command(create(SurfaceGatewayServiceCommandRequestSchema, {
      sessionId: this.sessionId,
      call,
      command,
    }), (error, response) => this.handleResponse(error, response?.event));
  }

  public close(): void {
    this.stopped = true;
    this.disconnect(false);
  }

  private handleResponse(error: grpc.ServiceError | null, event: SurfaceEvent | undefined): void {
    if (error) {
      this.fail(error);
      return;
    }
    this.emitProjectionEvent(event);
  }

  private emitProjection(event: SurfaceGatewayServiceStreamResponse): void {
    this.emitProjectionEvent(event.event);
  }

  private emitProjectionEvent(event: SurfaceEvent | undefined): void {
    const projection = surfaceEventToProjection(event);
    if (projection) this.emit('message', projection satisfies ProductSurfaceProjection);
  }

  private fail(error: Error): void {
    if (this._readyState === CLOSED) return;
    this.emit('error', error);
    this.disconnect(false);
  }

  private disconnect(emitClose: boolean): void {
    const shouldEmit = emitClose || this._readyState !== CLOSED;
    this._readyState = CLOSED;
    this.stream?.cancel();
    this.stream = null;
    this.client?.close();
    this.client = null;
    this.sessionId = '';
    if (shouldEmit) this.emit('close');
  }
}
