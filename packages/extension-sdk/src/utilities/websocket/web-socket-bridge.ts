import type { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import type { Disposable, ExtensionLogger } from '../../host/index';

type WsServerFactory = (opts: { host: string; port: number }) => WebSocketServer;

const defaultFactory: WsServerFactory = ({ host, port }) =>
  new WebSocketServer({ host, port });

export interface WebSocketBridgeOptions {
  host: string;
  port: number;
  path?: string;
  accessToken?: string;
}

export interface WebSocketBridgeHandlers {
  onJsonMessage(data: unknown): Promise<void> | void;
  onRawMessage?(buf: Buffer): Promise<void> | void;
  onClientConnected?(socket: WebSocket, req: IncomingMessage): void;
  onClientDisconnected?(): void;
}

/**
 * 可组合的 WebSocket 反向连接工具。
 *
 * 它不是一种扩展类型，只是给需要接入外部进程的扩展复用连接管理与帧分发。
 */
export class WebSocketBridge implements Disposable {
  private _wss: WebSocketServer | null = null;
  private _socket: WebSocket | null = null;

  constructor(
    private readonly _logger: ExtensionLogger,
    private readonly _handlers: WebSocketBridgeHandlers,
    private readonly _wsServerFactory: WsServerFactory = defaultFactory,
  ) {}

  start(options: WebSocketBridgeOptions): void {
    if (this._wss) {
      this._logger.warn('WebSocket bridge already running');
      return;
    }

    const wss = this._wsServerFactory({ host: options.host, port: options.port });
    this._wss = wss;

    const expectedPath = normalizeWebSocketPath(options.path);

    wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
      if (expectedPath && !this.isExpectedPath(req, expectedPath)) {
        socket.close(1008, 'Unexpected path');
        this._logger.warn('WebSocket bridge rejected client: unexpected path');
        return;
      }

      if (options.accessToken && !this.isAuthorized(req, options.accessToken)) {
        socket.close(1008, 'Unauthorized');
        this._logger.warn('WebSocket bridge rejected client: invalid access_token');
        return;
      }

      if (this._socket) {
        this._logger.warn('WebSocket bridge replaced existing client');
        this._socket.close();
      }

      this._socket = socket;
      this._logger.info(`WebSocket bridge client connected from ${req.socket.remoteAddress ?? 'unknown'}`);
      this._handlers.onClientConnected?.(socket, req);

      socket.on('message', (raw: Buffer) => {
        void this.dispatchMessage(raw);
      });

      socket.on('close', () => {
        if (this._socket === socket) this._socket = null;
        this._handlers.onClientDisconnected?.();
      });

      socket.on('error', (error: Error) => {
        this._logger.error(`WebSocket bridge socket error: ${error.message}`);
      });
    });

    wss.on('error', (error: Error) => {
      this._logger.error(`WebSocket bridge server error: ${error.message}`);
    });

    this._logger.info(
      `WebSocket bridge started on ws://${options.host}:${options.port}${expectedPath ?? ''}`,
    );
  }

  sendRaw(data: string | Buffer): boolean {
    if (!this._socket || this._socket.readyState !== WebSocket.OPEN) return false;
    this._socket.send(data);
    return true;
  }

  get isConnected(): boolean {
    return this._socket?.readyState === WebSocket.OPEN;
  }

  dispose(): void {
    if (this._socket) {
      this._socket.close();
      this._socket = null;
    }

    if (this._wss) {
      this._wss.close();
      this._wss = null;
      this._logger.info('WebSocket bridge stopped');
    }
  }

  private isAuthorized(req: IncomingMessage, accessToken: string): boolean {
    const url = req.url ?? '';
    const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    const provided = new URLSearchParams(query).get('access_token');
    return provided === accessToken;
  }

  private isExpectedPath(req: IncomingMessage, expectedPath: string): boolean {
    try {
      const url = new URL(req.url ?? '/', 'ws://localhost');
      return normalizeWebSocketPath(url.pathname) === expectedPath;
    } catch {
      return false;
    }
  }

  private async dispatchMessage(buf: Buffer): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(buf.toString('utf8'));
      await Promise.resolve(this._handlers.onJsonMessage(parsed));
    } catch {
      await Promise.resolve(this._handlers.onRawMessage?.(buf));
    }
  }
}

export type { WebSocket };

function normalizeWebSocketPath(path: string | undefined): string | undefined {
  const trimmed = String(path ?? '').trim();
  if (!trimmed || trimmed === '/') return undefined;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
