import { EventEmitter } from 'node:events';
import {
  SURFACE_GATEWAY_CLOSED,
  SURFACE_GATEWAY_OPEN,
  type SurfaceGatewayClientLike,
} from './surface-gateway-client';
import type { ProductSurfaceProjection, ProductSurfaceRequest } from './surface-grpc-mapper';

export class SurfaceGatewayTestDouble extends EventEmitter implements SurfaceGatewayClientLike {
  public readyState = SURFACE_GATEWAY_CLOSED;
  public readonly sent: ProductSurfaceRequest[] = [];
  public onSend: ((frame: ProductSurfaceRequest) => void) | undefined;

  public connect(_endpoint: string, _generation: string, _productId: string): Promise<void> {
    this.readyState = SURFACE_GATEWAY_OPEN;
    queueMicrotask(() => this.emit('open'));
    return Promise.resolve();
  }

  public submit(frame: ProductSurfaceRequest): void {
    this.sent.push(frame);
    this.onSend?.(frame);
  }

  public emitFrame(frame: ProductSurfaceProjection): void {
    this.emit('message', frame);
  }

  public close(): void {
    if (this.readyState === SURFACE_GATEWAY_CLOSED) return;
    this.readyState = SURFACE_GATEWAY_CLOSED;
    queueMicrotask(() => this.emit('close'));
  }
}
