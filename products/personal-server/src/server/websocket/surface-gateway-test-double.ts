import { EventEmitter } from 'node:events';
import {
  SURFACE_GATEWAY_CLOSED,
  SURFACE_GATEWAY_OPEN,
  type SurfaceGatewayClientLike,
} from './surface-gateway-client';

export class SurfaceGatewayTestDouble extends EventEmitter implements SurfaceGatewayClientLike {
  public readyState = SURFACE_GATEWAY_CLOSED;
  public readonly sent: string[] = [];
  public onSend: ((serialized: string) => void) | undefined;

  public connect(_endpoint: string, _generation: string, _productId: string): Promise<void> {
    this.readyState = SURFACE_GATEWAY_OPEN;
    queueMicrotask(() => this.emit('open'));
    return Promise.resolve();
  }

  public send(serialized: string): void {
    this.sent.push(serialized);
    this.onSend?.(serialized);
  }

  public emitFrame(frame: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(frame), 'utf8'));
  }

  public close(): void {
    if (this.readyState === SURFACE_GATEWAY_CLOSED) return;
    this.readyState = SURFACE_GATEWAY_CLOSED;
    queueMicrotask(() => this.emit('close'));
  }
}
