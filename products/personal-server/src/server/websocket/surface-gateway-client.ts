import { EventEmitter } from 'node:events';
import * as grpc from '@grpc/grpc-js';
import { create, fromBinary, toBinary, type DescMessage, type MessageShape } from '@bufbuild/protobuf';
import { CallMetadataSchema } from '@glimmer-cradle/contracts/glimmer/common/v1/service_contract_pb';
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

export const SURFACE_GATEWAY_OPEN = 1;
export const SURFACE_GATEWAY_CONNECTING = 0;
export const SURFACE_GATEWAY_CLOSED = 3;

export interface SurfaceGatewayClientLike {
  readonly readyState: number;
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  submit(frame: ProductSurfaceRequest): void;
  connect(endpoint: string, generation: string, productId: string): Promise<void>;
  close(): void;
}

export type SurfaceGatewayClientFactory = () => SurfaceGatewayClientLike;

type SurfaceGrpcClient = grpc.Client & {
  Connect(request: SurfaceGatewayServiceConnectRequest, callback: (error: grpc.ServiceError | null, response: SurfaceGatewayServiceConnectResponse) => void): void;
  Query(request: SurfaceGatewayServiceQueryRequest, callback: (error: grpc.ServiceError | null, response: SurfaceGatewayServiceQueryResponse) => void): void;
  Command(request: SurfaceGatewayServiceCommandRequest, callback: (error: grpc.ServiceError | null, response: SurfaceGatewayServiceCommandResponse) => void): void;
  Stream(request: unknown): grpc.ClientReadableStream<SurfaceGatewayServiceStreamResponse>;
};

function method<I extends DescMessage, O extends DescMessage>(
  path: string,
  input: I,
  output: O,
  responseStream = false,
): grpc.MethodDefinition<MessageShape<I>, MessageShape<O>> {
  return {
    path,
    requestStream: false,
    responseStream,
    requestSerialize: (value) => Buffer.from(toBinary(input, value)),
    requestDeserialize: (value) => fromBinary(input, value),
    responseSerialize: (value) => Buffer.from(toBinary(output, value)),
    responseDeserialize: (value) => fromBinary(output, value),
  };
}

const definition: grpc.ServiceDefinition = {
  Connect: method('/glimmer.surface.v1.SurfaceGatewayService/Connect', SurfaceGatewayServiceConnectRequestSchema, SurfaceGatewayServiceConnectResponseSchema),
  Query: method('/glimmer.surface.v1.SurfaceGatewayService/Query', SurfaceGatewayServiceQueryRequestSchema, SurfaceGatewayServiceQueryResponseSchema),
  Command: method('/glimmer.surface.v1.SurfaceGatewayService/Command', SurfaceGatewayServiceCommandRequestSchema, SurfaceGatewayServiceCommandResponseSchema),
  Stream: method('/glimmer.surface.v1.SurfaceGatewayService/Stream', SurfaceGatewayServiceStreamRequestSchema, SurfaceGatewayServiceStreamResponseSchema, true),
};

const ClientConstructor = grpc.makeGenericClientConstructor(definition, 'SurfaceGatewayService') as unknown as {
  new(address: string, credentials: grpc.ChannelCredentials): SurfaceGrpcClient;
};

export class SurfaceGatewayClient extends EventEmitter {
  private client: SurfaceGrpcClient | null = null;
  private stream: grpc.ClientReadableStream<SurfaceGatewayServiceStreamResponse> | null = null;
  private sessionId = '';
  private stopped = false;
  private _readyState = SURFACE_GATEWAY_CLOSED;

  public get readyState(): number { return this._readyState; }

  public async connect(endpoint: string, generation: string, productId: string): Promise<void> {
    this.stopped = false;
    this._readyState = SURFACE_GATEWAY_CONNECTING;
    const client = new ClientConstructor(endpoint.replace(/^grpc:\/\//u, ''), grpc.credentials.createInsecure());
    this.client = client;
    const response = await new Promise<SurfaceGatewayServiceConnectResponse>((resolve, reject) => {
      client.Connect(create(SurfaceGatewayServiceConnectRequestSchema, {
        productId,
        generation,
        scopes: ['surface:read', 'surface:write'],
        call: create(CallMetadataSchema, { traceId: `${productId}-surface-${Date.now()}` }),
      }), (error, result) => error ? reject(error) : resolve(result));
    });
    if (!response.accepted || !response.sessionId) throw new Error(response.message || 'Surface Gateway Connect rejected');
    this.sessionId = response.sessionId;
    const stream = client.Stream(create(SurfaceGatewayServiceStreamRequestSchema, {
      sessionId: this.sessionId,
      call: create(CallMetadataSchema, { traceId: `${productId}-surface-stream-${Date.now()}` }),
    }));
    this.stream = stream;
    stream.on('data', (event) => {
      this.emitProjection(event.event);
    });
    stream.once('end', () => this.disconnect());
    stream.once('error', (error) => this.fail(error));
    this._readyState = SURFACE_GATEWAY_OPEN;
    this.emit('open');
  }

  public submit(frame: ProductSurfaceRequest): void {
    if (this._readyState !== SURFACE_GATEWAY_OPEN || !this.client || !this.sessionId) return;
    const call = create(CallMetadataSchema, {
      traceId: frame.trace_id ?? `${frame.kind}-${Date.now()}`,
      idempotencyKey: 'request_id' in frame ? frame.request_id : '',
    });
    const query = queryFromSurfaceRequest(frame);
    if (query) {
      this.client.Query(create(SurfaceGatewayServiceQueryRequestSchema, {
        sessionId: this.sessionId, call, query,
      }), (error, response) => this.handleResponse(error, response?.event));
      return;
    }
    const command = commandFromSurfaceRequest(frame);
    if (!command) {
      this.emit('error', new Error(`Surface 请求类型不受支持：${frame.kind}`));
      return;
    }
    this.client.Command(create(SurfaceGatewayServiceCommandRequestSchema, {
      sessionId: this.sessionId, call, command,
    }), (error, response) => this.handleResponse(error, response?.event));
  }

  public close(): void {
    this.stopped = true;
    this.disconnect();
  }

  private handleResponse(error: grpc.ServiceError | null, event: SurfaceEvent | undefined): void {
    if (error) { this.fail(error); return; }
    this.emitProjection(event);
  }

  private emitProjection(event: SurfaceEvent | undefined): void {
    const projection = surfaceEventToProjection(event);
    if (projection) this.emit('message', projection satisfies ProductSurfaceProjection);
  }

  private fail(error: Error): void {
    if (this._readyState === SURFACE_GATEWAY_CLOSED) return;
    this.emit('error', error);
    this.disconnect();
  }

  private disconnect(): void {
    const emitClose = this._readyState !== SURFACE_GATEWAY_CLOSED;
    this._readyState = SURFACE_GATEWAY_CLOSED;
    this.stream?.cancel();
    this.stream = null;
    this.client?.close();
    this.client = null;
    this.sessionId = '';
    if (emitClose) this.emit('close');
  }
}
