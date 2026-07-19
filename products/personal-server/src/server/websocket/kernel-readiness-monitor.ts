import type { RuntimeReadinessCatalog } from '@glimmer-cradle/protocol';
import { WebSocket } from 'ws';

export interface KernelReadinessStatus {
  readonly ready: boolean;
  readonly status: 'starting' | 'ready' | 'failed';
  readonly summary: string;
  readonly connection_state: 'disconnected' | 'connecting' | 'observing';
  readonly observed_at?: number;
  readonly connection_error?: string;
  readonly blocking_runtimes: ReadonlyArray<{
    runtime_id: string;
    state: string;
    summary: string;
  }>;
}

type EndpointResolver = () => Promise<string | null>;

export class KernelReadinessMonitor {
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private catalog: RuntimeReadinessCatalog | null = null;
  private connectionState: KernelReadinessStatus['connection_state'] = 'disconnected';
  private observedAt: number | undefined;
  private connectionError: string | undefined;
  private stopped = true;

  public constructor(
    private readonly resolveEndpoint: EndpointResolver,
    private readonly reconnectDelayMs = 500,
    private readonly onKernelShutdown?: () => void,
  ) {}

  public start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  public stop(): void {
    this.stopped = true;
    this.catalog = null;
    this.connectionState = 'disconnected';
    this.observedAt = undefined;
    this.connectionError = undefined;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close();
    }
  }

  public getStatus(): KernelReadinessStatus {
    return {
      ...deriveKernelReadinessStatus(this.catalog),
      connection_state: this.connectionState,
      ...(this.observedAt === undefined ? {} : { observed_at: this.observedAt }),
      ...(this.connectionError === undefined ? {} : { connection_error: this.connectionError }),
    };
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.socket) return;
    let endpoint: string | null;
    try {
      endpoint = await this.resolveEndpoint();
    } catch (error) {
      this.connectionError = error instanceof Error ? error.message : String(error);
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;
    if (!endpoint) {
      this.scheduleReconnect();
      return;
    }

    const socket = new WebSocket(endpoint);
    this.socket = socket;
    this.connectionState = 'connecting';
    this.connectionError = undefined;
    this.connectTimer = setTimeout(() => {
      if (this.socket === socket && socket.readyState === WebSocket.CONNECTING) {
        this.connectionError = '连接 Kernel Control Surface 超时';
        socket.terminate();
      }
    }, 3_000);
    this.connectTimer.unref();
    socket.once('open', () => {
      if (this.socket !== socket) return;
      this.clearConnectTimer();
      this.connectionState = 'observing';
      this.connectionError = undefined;
    });
    socket.on('message', (raw) => {
      let frame: unknown;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (isShutdownFrame(frame)) {
        this.catalog = null;
        this.connectionState = 'disconnected';
        this.observedAt = undefined;
        this.onKernelShutdown?.();
        return;
      }
      if (!isRuntimeReadinessFrame(frame)) return;
      this.catalog = frame.runtime_readiness;
      this.observedAt = Date.now();
    });
    socket.once('close', () => this.handleDisconnect(socket));
    socket.once('error', (error) => {
      if (this.socket === socket) this.connectionError = error.message;
    });
  }

  private handleDisconnect(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.clearConnectTimer();
    this.socket = null;
    this.catalog = null;
    this.connectionState = 'disconnected';
    this.observedAt = undefined;
    this.scheduleReconnect();
  }

  private clearConnectTimer(): void {
    if (!this.connectTimer) return;
    clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.reconnectDelayMs);
    this.reconnectTimer.unref();
  }
}

function isShutdownFrame(value: unknown): value is { kind: 'shutdown' } {
  return Boolean(value && typeof value === 'object' && (value as Record<string, unknown>).kind === 'shutdown');
}

export function deriveKernelReadinessStatus(
  catalog: RuntimeReadinessCatalog | null,
): Omit<KernelReadinessStatus, 'connection_state' | 'observed_at' | 'connection_error'> {
  const runtimes = catalog?.runtimes ?? [];
  const ingress = runtimes.find((runtime) => runtime.runtime_id === 'kernel.ingress');
  const blocking = runtimes.filter((runtime) => runtime.blocking);
  const blockingRuntimes = blocking.map((runtime) => ({
    runtime_id: runtime.runtime_id,
    state: runtime.state,
    summary: runtime.summary,
  }));

  if (blocking.some((runtime) => runtime.state === 'failed')) {
    return {
      ready: false,
      status: 'failed',
      summary: 'Kernel 必需运行体启动失败',
      blocking_runtimes: blockingRuntimes,
    };
  }
  const ready = ingress?.state === 'ready'
    && blocking.length > 0
    && blocking.every((runtime) => runtime.state === 'ready');
  return {
    ready,
    status: ready ? 'ready' : 'starting',
    summary: ready ? 'Kernel 输入主线已就绪' : '等待 Kernel 输入主线开放',
    blocking_runtimes: blockingRuntimes,
  };
}

function isRuntimeReadinessFrame(
  value: unknown,
): value is { kind: 'runtime_readiness'; runtime_readiness: RuntimeReadinessCatalog } {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Record<string, unknown>;
  if (frame.kind !== 'runtime_readiness') return false;
  const catalog = frame.runtime_readiness;
  return Boolean(
    catalog
    && typeof catalog === 'object'
    && Array.isArray((catalog as Record<string, unknown>).runtimes),
  );
}
