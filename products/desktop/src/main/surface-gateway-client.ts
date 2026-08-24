import { EventEmitter } from 'node:events';
import * as grpc from '@grpc/grpc-js';
import { create, fromBinary, toBinary, toJson, type DescMessage, type JsonObject, type MessageShape } from '@bufbuild/protobuf';
import { StructSchema } from '@bufbuild/protobuf/wkt';
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
} from '@glimmer-cradle/contracts/glimmer/surface/v1/surface_gateway_pb';

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
      topics: ['presentation'],
      call: create(CallMetadataSchema, { traceId: `desktop-surface-stream-${Date.now()}` }),
    }));
    this.stream = stream;
    stream.on('data', (event) => this.emitProjection(event));
    stream.once('end', () => this.disconnect(false));
    stream.once('error', (error) => this.fail(error));
    this._readyState = OPEN;
    this.emit('open');
  }

  public send(serialized: string): void {
    if (this._readyState !== OPEN || !this.client || !this.sessionId) return;
    let frame: Record<string, unknown>;
    try { frame = JSON.parse(serialized) as Record<string, unknown>; } catch { return; }
    const request = {
      sessionId: this.sessionId,
      call: create(CallMetadataSchema, {
        traceId: typeof frame.trace_id === 'string' ? frame.trace_id : `desktop-surface-${Date.now()}`,
        idempotencyKey: typeof frame.request_id === 'string' ? frame.request_id : '',
      }),
      arguments: JSON.parse(JSON.stringify({ frame })) as JsonObject,
    };
    const isQuery = new Set([
      'config_snapshot_request',
      'conversation_history_request',
      'skill_catalog_request',
      'extension_runtime_projection_request',
    ]).has(typeof frame.kind === 'string' ? frame.kind : '');
    if (isQuery) {
      this.client.Query(create(SurfaceGatewayServiceQueryRequestSchema, { ...request, query: String(frame.kind) }), (error, response) => {
        this.handleResponse(error, response?.projection);
      });
    } else {
      this.client.Command(create(SurfaceGatewayServiceCommandRequestSchema, { ...request, command: String(frame.kind || '') }), (error, response) => {
        this.handleResponse(error, response?.result);
      });
    }
  }

  public close(): void {
    this.stopped = true;
    this.disconnect(false);
  }

  private handleResponse(error: grpc.ServiceError | null, projection: unknown): void {
    if (error) {
      this.fail(error);
      return;
    }
    if (projection && typeof projection === 'object') {
      this.emit('message', Buffer.from(JSON.stringify(structToJson(projection)), 'utf8'));
    }
  }

  private emitProjection(event: SurfaceGatewayServiceStreamResponse): void {
    if (!event.projection) return;
    this.emit('message', Buffer.from(JSON.stringify(structToJson(event.projection)), 'utf8'));
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

function structToJson(value: unknown): unknown {
  try { return toJson(StructSchema, value as never); } catch { return value; }
}
