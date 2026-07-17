import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { AddressInfo } from 'node:net';
import { EventBus } from '../../../foundation/event-bus/event-bus';
import { getLogger } from '../../../foundation/logger/logger';
import {
  VisualCommandDispatchEvent,
  AvatarActionStateChangedEvent,
  AvatarStatusChangedEvent,
} from '../../../foundation/event-bus/events';
import { getPresentationFrameClass } from '@glimmer-cradle/protocol';
import type {
  PresentationDownstreamFrame,
  AvatarConfig,
  PresentationUpstreamFrame,
  CharacterPresentationProjectionPayload,
  AvatarHostHelloPayload,
  AvatarHostReadyPayload,
  VisualCommand,
} from '@glimmer-cradle/protocol';
import type { RuntimeReadinessSnapshot } from '../../../foundation/runtime-readiness';
import {
  strongestRuntimeResourceState,
  type RuntimeResourceSnapshot,
} from '../../../foundation/runtime-reconciler';
import { RuntimeReadinessCatalogStore } from '../../../foundation/runtime-readiness-catalog';
import { UnityAvatarHostProcess } from './unity-avatar-host-process';
import { buildAvatarResourceSnapshots } from './avatar-resource-catalog';
import { EndpointRegistry } from '../../../foundation/endpoints/endpoint-registry';

const logger = getLogger('avatar-engine');
const AVATAR_RUNTIME_MODULE_NAME = 'avatar-runtime';

type AvatarLifecycleState = NonNullable<CharacterPresentationProjectionPayload['avatar_state']>;

const DEFAULT_PRESENTATION: NonNullable<PresentationDownstreamFrame['presentation']> = {
  display_scale: 1.2,
};

const DEFAULT_HOST_READY: AvatarHostReadyPayload = {
  worker_window_state: 'unknown',
  composition_surface_state: 'unknown',
  first_frame_presented: false,
  interaction_ready: false,
  summary: '等待 Avatar 生命周期门完成',
};

export class AvatarController {
  private static _instance: AvatarController | null = null;
  private _wss: WebSocketServer | null = null;
  private readonly _clients: Set<WebSocket> = new Set();
  private readonly _readyClients: Set<WebSocket> = new Set();
  private readonly _lastHeartbeatByClient: Map<WebSocket, number> = new Map();
  private readonly _lastErrorByClient: Map<WebSocket, string> = new Map();
  private _heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private _initialized = false;
  private _heartbeatIntervalMs = 10000;
  private _heartbeatTimeoutMs = 30000;
  private _lastBroadcastConnected = false;
  private _config: AvatarConfig | null = null;
  private _lastHostHello: AvatarHostHelloPayload | null = null;
  private _lastHostReady: AvatarHostReadyPayload | null = null;
  private _desiredPresentation: NonNullable<PresentationDownstreamFrame['presentation']> = DEFAULT_PRESENTATION;
  private _disposeProcessSubscription: (() => void) | null = null;

  public static get instance(): AvatarController {
    if (!AvatarController._instance) {
      AvatarController._instance = new AvatarController();
    }
    return AvatarController._instance;
  }

  private constructor() {}

  public async init(config: AvatarConfig): Promise<void> {
    if (this._initialized) return;

    this._config = config;
    this._heartbeatIntervalMs = config.heartbeat_interval_ms;
    this._heartbeatTimeoutMs = config.heartbeat_timeout_ms;
    this._disposeProcessSubscription = UnityAvatarHostProcess.instance.subscribe(() => {
      this._syncRuntimeReadiness();
    });
    this._wss = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 2 * 1024 * 1024 });
    await waitForWebSocketServer(this._wss);
    const address = this._wss.address() as AddressInfo;
    const endpoint = `ws://127.0.0.1:${address.port}`;
    await EndpointRegistry.instance.publish('avatar-host', endpoint);
    UnityAvatarHostProcess.instance.configure(config.host, endpoint);

    this._wss.on('connection', (ws: WebSocket) => {
      logger.info('Avatar 已连接');
      this._clients.add(ws);
      this._lastHeartbeatByClient.set(ws, Date.now());
      this._emitStatusIfChanged('connected');

      ws.on('message', (message: RawData) => {
        this._handleRawMessage(message, ws);
      });

      ws.on('close', () => {
        logger.warn('Avatar 已断开');
        this._clients.delete(ws);
        this._readyClients.delete(ws);
        this._lastHeartbeatByClient.delete(ws);
        this._lastErrorByClient.delete(ws);
        this._emitStatusIfChanged('disconnected');
      });

      ws.on('error', (err) => {
        logger.error('Avatar WebSocket 错误', { err });
        this._syncRuntimeReadiness();
      });
    });

    EventBus.instance.subscribe('VisualCommandDispatchEvent', async (event) => {
      const payload = (event as VisualCommandDispatchEvent).payload;
      await this.sendVisualCommand(payload);
    });

    this._heartbeatInterval = setInterval(() => {
      this._tickHeartbeat();
    }, this._heartbeatIntervalMs);

    this._initialized = true;
    logger.info('Avatar 网关已初始化', { endpoint });
    this._emitStatusIfChanged('init');
  }

  public async stop(): Promise<void> {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }

    const shutdownFrame: PresentationDownstreamFrame = {
      kind: 'shutdown',
      timestamp: Date.now(),
    };
    const shutdownPayload = JSON.stringify(shutdownFrame);
    for (const client of this._clients) {
      this._sendRaw(client, shutdownPayload);
    }

    await UnityAvatarHostProcess.instance.stop();

    if (this._wss) {
      this._wss.clients.forEach((client) => client.terminate());
      this._wss.close();
      this._wss = null;
    }
    await EndpointRegistry.instance.revoke('avatar-host');
    this._clients.clear();
    this._readyClients.clear();
    this._lastHeartbeatByClient.clear();
    this._lastErrorByClient.clear();
    this._lastHostHello = null;
    this._lastHostReady = null;
    this._initialized = false;
    this._disposeProcessSubscription?.();
    this._disposeProcessSubscription = null;
    this._emitStatusIfChanged('disconnected');
    this._config = null;
    logger.info('Avatar 网关已停止');
  }

  public get isRendererConnected(): boolean {
    return this._readyClients.size > 0;
  }

  public updatePresentation(
    presentation: NonNullable<PresentationDownstreamFrame['presentation']>,
  ): void {
    this._desiredPresentation = {
      placement_id: presentation.placement_id || undefined,
      display_scale: presentation.display_scale ?? this._desiredPresentation.display_scale ?? DEFAULT_PRESENTATION.display_scale,
      reset_placement: presentation.reset_placement || undefined,
    };
  }

  public getCharacterPresentationProjection(): CharacterPresentationProjectionPayload {
    const avatarState = this._resolveLifecycleState();
    const lifecycle = this._lastHostReady ?? DEFAULT_HOST_READY;
    const avatarPackageId = this._lastHostReady?.avatar_package_id
      ?? this._lastHostHello?.avatar_package_id
      ?? '';
    const modelId = this._lastHostReady?.model_id
      ?? this._lastHostHello?.model_id
      ?? '';

    return {
      avatar_package_id: avatarPackageId || 'unresolved',
      model_id: modelId || 'unresolved',
      display_name: avatarPackageId || modelId || 'Avatar',
      kind: 'live2d',
      backend: 'unity',
      host_kind: this.isRendererConnected ? 'unity' : 'offline',
      avatar_state: avatarState,
      appearance: {
        placement_id: this._desiredPresentation.placement_id || undefined,
        display_scale: this._desiredPresentation.display_scale ?? DEFAULT_PRESENTATION.display_scale ?? 1.2,
      },
      lifecycle: {
        worker_window_state: lifecycle.worker_window_state,
        composition_surface_state: lifecycle.composition_surface_state,
        first_frame_presented: lifecycle.first_frame_presented,
        interaction_ready: lifecycle.interaction_ready,
        ready: this.isRendererConnected && lifecycle.first_frame_presented && lifecycle.interaction_ready,
        summary: lifecycle.summary || this.getReadinessSnapshot().summary,
      },
    };
  }

  public getReadinessSnapshot(): RuntimeReadinessSnapshot {
    const hostProcess = UnityAvatarHostProcess.instance.getSnapshot();
    const resources: RuntimeResourceSnapshot[] = [
      ...buildAvatarResourceSnapshots({
        commandPath: hostProcess.command,
        workingDir: hostProcess.cwd,
      }),
      {
        resource_id: 'avatar.host.process',
        resource_kind: 'managed-process',
        desired_state: 'ready',
        actual_state: hostProcess.state === 'running' || hostProcess.state === 'starting' ? 'ready' : hostProcess.state === 'failed' ? 'failed' : 'pending',
        readiness: hostProcess.state === 'running' || hostProcess.state === 'starting' ? 'ready' : hostProcess.state === 'failed' ? 'failed' : 'pending',
        summary: hostProcess.command ? `Avatar host: ${hostProcess.state}` : 'Unity Avatar Host 尚未配置',
        recovery_actions: hostProcess.command ? ['检查 Avatar 进程与构建产物'] : ['检查 avatar.host.command'],
      },
      {
        resource_id: 'avatar.worker-window',
        resource_kind: 'window-lifecycle',
        desired_state: 'ready',
        actual_state: this._lastHostReady?.worker_window_state === 'isolated' ? 'ready' : this._lastHostReady?.worker_window_state === 'visible' ? 'degraded' : 'pending',
        readiness: this._lastHostReady?.worker_window_state === 'isolated' ? 'ready' : this._lastHostReady?.worker_window_state === 'visible' ? 'degraded' : 'pending',
        summary: this._lastHostReady?.worker_window_state === 'isolated'
          ? 'worker window 已退居后台工作容器'
          : this._lastHostReady?.worker_window_state === 'visible'
            ? 'worker window 仍可见，存在启动闪窗风险'
            : '等待 worker window 生命周期确认',
        recovery_actions: ['检查 Unity worker window 隔离与 show worker 开关'],
      },
      {
        resource_id: 'avatar.composition-surface',
        resource_kind: 'composition-surface',
        desired_state: 'ready',
        actual_state: this._lastHostReady?.composition_surface_state === 'attached'
          ? 'ready'
          : this._lastHostReady?.composition_surface_state === 'failed'
            ? 'failed'
            : 'pending',
        readiness: this._lastHostReady?.composition_surface_state === 'attached'
          ? 'ready'
          : this._lastHostReady?.composition_surface_state === 'failed'
            ? 'failed'
            : 'pending',
        summary: this._lastHostReady?.composition_surface_state === 'attached'
          ? '正式透明合成表面已附着'
          : this._lastHostReady?.composition_surface_state === 'failed'
            ? '正式透明合成表面附着失败'
            : '等待正式透明合成表面附着',
        recovery_actions: ['检查 Native Composition Host 构建与 surface attach'],
      },
      {
        resource_id: 'avatar.first-frame',
        resource_kind: 'first-frame',
        desired_state: 'ready',
        actual_state: this._lastHostReady?.first_frame_presented ? 'ready' : 'pending',
        readiness: this._lastHostReady?.first_frame_presented ? 'ready' : 'pending',
        summary: this._lastHostReady?.first_frame_presented ? '正式身体首帧已呈现' : '等待正式身体首帧呈现',
        recovery_actions: ['检查模型 driver、Composition Host 与首帧 present'],
      },
    ];

    if (!this._config) {
      return {
        runtime_id: 'avatar.host',
        owner: 'renderer',
        phase: 'surfaces',
        state: 'stopped',
        blocking: false,
        summary: 'Avatar 未启用',
        reconciler: {
          desired: 'formal-avatar-package-ready',
          actual: 'disabled',
          readiness: 'unknown',
          resources,
        },
      };
    }

    const readiness = strongestRuntimeResourceState(resources);
    const projection = this.getCharacterPresentationProjection();
    const summary = projection.lifecycle.summary;

    if (this.isRendererConnected) {
      return {
        runtime_id: 'avatar.host',
        owner: 'renderer',
        phase: 'surfaces',
        state: 'ready',
        blocking: false,
        summary,
        details_ref: 'data/observability/logs/application/avatar-host.console.log',
        reconciler: {
          desired: 'formal-avatar-package-ready',
          actual: 'connected-first-frame-presented',
          readiness,
          resources,
        },
      };
    }

    if (this._clients.size > 0) {
      const lastError = Array.from(this._lastErrorByClient.values()).at(-1);
      return {
        runtime_id: 'avatar.host',
        owner: 'renderer',
        phase: 'surfaces',
        state: 'degraded',
        blocking: false,
        summary: lastError
          ? `Unity Avatar 已连接，但尚未完成正式身体就绪：${lastError}`
          : summary,
        details_ref: 'data/observability/logs/application/avatar-host.console.log',
        reconciler: {
          desired: 'formal-avatar-package-ready',
          actual: 'connected-waiting-ready-gates',
          readiness,
          resources,
        },
      };
    }

    if (hostProcess.launch_mode === 'manual') {
      return {
        runtime_id: 'avatar.host',
        owner: 'renderer',
        phase: 'surfaces',
        state: 'degraded',
        blocking: false,
        summary: '等待手动启动 Unity Avatar',
        details_ref: 'docs/guides/桌面渲染开发指南.md#unity-avatar',
        reconciler: {
          desired: 'formal-avatar-package-ready',
          actual: 'waiting-manual-launch',
          readiness,
          resources,
        },
      };
    }

    if (hostProcess.state === 'running' || hostProcess.state === 'starting') {
      const timeoutMs = this._config.host.startup_timeout_ms;
      const startedAtMs = hostProcess.started_at_ms ?? Date.now();
      const timedOut = Date.now() - startedAtMs > timeoutMs;
      return {
        runtime_id: 'avatar.host',
        owner: 'renderer',
        phase: 'surfaces',
        state: timedOut ? 'degraded' : 'starting',
        blocking: false,
        summary: timedOut
          ? 'Unity Avatar 进程已启动，但连接或首帧准备超时'
          : 'Unity Avatar 进程已启动，等待连接与首帧',
        details_ref: 'data/observability/logs/application/avatar-host.console.log',
        reconciler: {
          desired: 'formal-avatar-package-ready',
          actual: timedOut ? 'host-timeout' : 'host-starting',
          readiness,
          resources,
        },
      };
    }

    return {
      runtime_id: 'avatar.host',
      owner: 'renderer',
      phase: 'surfaces',
      state: 'degraded',
      blocking: false,
      summary: hostProcess.last_error
        ? `Unity Avatar 启动异常：${hostProcess.last_error}`
        : 'Unity Avatar 尚未连接',
      details_ref: 'data/observability/logs/application/avatar-host.console.log',
      reconciler: {
        desired: 'formal-avatar-package-ready',
        actual: hostProcess.last_error ? 'host-failed' : 'host-disconnected',
        readiness,
        resources,
      },
    };
  }

  public broadcastFrame(frame: PresentationDownstreamFrame): void {
    const payload = JSON.stringify(frame);
    if (frame.kind !== 'presentation') {
      logger.debug('向 Avatar 广播帧', {
        frame_class: getPresentationFrameClass(frame.kind),
        kind: frame.kind,
        trace_id: frame.trace_id,
      });
    }

    for (const client of this._readyClients) {
      this._sendRaw(client, payload);
    }
  }

  public async sendVisualCommand(command: VisualCommand): Promise<boolean> {
    if (!this.isRendererConnected) return false;

    for (const frame of this._visualCommandToFrames(command)) {
      this.broadcastFrame(frame);
    }
    return true;
  }

  private _handleRawMessage(message: RawData, ws: WebSocket): void {
    try {
      const frame = JSON.parse(message.toString()) as PresentationUpstreamFrame;
      this._handleUpstream(frame, ws);
    } catch (err) {
      logger.warn('无法解析 Avatar 消息', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private _handleUpstream(frame: PresentationUpstreamFrame, ws: WebSocket): void {
    if (!frame || typeof frame.kind !== 'string') {
      logger.warn('Avatar 发送了无效帧');
      return;
    }

    this._lastHeartbeatByClient.set(ws, Date.now());

    switch (frame.kind) {
      case 'host_hello': {
        const hello = frame.host_hello ?? null;
        this._lastHostHello = hello;
        logger.info('Avatar hello', {
          host_kind: hello?.host_kind,
          host_id: hello?.host_id,
          host_version: hello?.host_version,
          model_id: hello?.model_id,
          avatar_package_id: hello?.avatar_package_id,
        });
        this._emitStatusIfChanged('host_hello', true);
        break;
      }
      case 'host_ready': {
        const readyPayload = frame.host_ready ?? null;
        const ready = Boolean(
          readyPayload
          && readyPayload.worker_window_state === 'isolated'
          && readyPayload.composition_surface_state === 'attached'
          && readyPayload.first_frame_presented
          && readyPayload.interaction_ready,
        );
        this._lastHostReady = readyPayload;
        if (ready) {
          this._readyClients.add(ws);
          this._lastErrorByClient.delete(ws);
          logger.info('Avatar 已完成首帧呈现并就绪', {
            model_id: readyPayload?.model_id,
            avatar_package_id: readyPayload?.avatar_package_id,
          });
        } else {
          this._readyClients.delete(ws);
          logger.warn('Avatar 上报了未满足 ready gate 的 host_ready', { host_ready: readyPayload });
        }
        this._emitStatusIfChanged(ready ? 'host_ready' : 'connected', true);
        break;
      }
      case 'heartbeat':
      case 'pong':
        break;
      case 'animation_complete':
        logger.debug('Avatar 动画完成', { animation_complete: frame.animation_complete });
        break;
      case 'avatar_action_state':
        if (!frame.avatar_action_state) {
          logger.warn('Avatar 动作状态帧缺少载荷');
          break;
        }
        void EventBus.instance.publish(
          new AvatarActionStateChangedEvent(frame.avatar_action_state),
        ).catch((err) => logger.error('AvatarActionStateChangedEvent publish 失败', { err }));
        break;
      case 'error':
        this._lastErrorByClient.set(
          ws,
          frame.error?.message ?? frame.error?.code ?? 'Avatar 上报未知错误',
        );
        logger.error('Avatar 上报错误', { error: frame.error });
        this._syncRuntimeReadiness();
        break;
      default:
        logger.debug('暂未处理的 Avatar 上行帧', { kind: frame.kind });
    }
  }

  private _resolveLifecycleState(): AvatarLifecycleState {
    if (!this._config) return 'stopped';
    if (this.isRendererConnected) return 'ready';
    if (this._clients.size > 0) return 'degraded';

    const hostProcess = UnityAvatarHostProcess.instance.getSnapshot();
    if (hostProcess.state === 'starting' || hostProcess.state === 'running') return 'starting';
    if (hostProcess.state === 'stopped' || hostProcess.state === 'exited') return 'pending';
    if (hostProcess.state === 'failed') return 'degraded';
    return 'pending';
  }

  private _tickHeartbeat(): void {
    const now = Date.now();
    const pingFrame: PresentationDownstreamFrame = {
      kind: 'ping',
      timestamp: now,
    };
    const pingPayload = JSON.stringify(pingFrame);

    for (const client of this._clients) {
      this._sendRaw(client, pingPayload);

      if (!this._readyClients.has(client)) continue;
      const lastHeartbeat = this._lastHeartbeatByClient.get(client) ?? 0;
      if (now - lastHeartbeat > this._heartbeatTimeoutMs) {
        logger.warn('Avatar 心跳超时，标记为未就绪');
        this._readyClients.delete(client);
        this._emitStatusIfChanged('heartbeat_timeout');
      }
    }
  }

  private _sendRaw(client: WebSocket, payload: string): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }

  private _emitStatusIfChanged(
    reason: 'connected' | 'disconnected' | 'heartbeat_timeout' | 'init' | 'host_hello' | 'host_ready',
    force = false,
  ): void {
    this._syncRuntimeReadiness();
    const current = this.isRendererConnected;
    if (!force && current === this._lastBroadcastConnected && reason !== 'init') return;
    this._lastBroadcastConnected = current;
    void EventBus.instance.publish(
      new AvatarStatusChangedEvent({
        hostKind: current ? 'unity' : 'offline',
        reason,
      }),
    ).catch((err) => logger.error('AvatarStatusChangedEvent publish 失败', { err }));
  }

  private _syncRuntimeReadiness(): void {
    if (!this._config) return;
    RuntimeReadinessCatalogStore.instance.replaceModuleSnapshots(
      AVATAR_RUNTIME_MODULE_NAME,
      [this.getReadinessSnapshot()],
    );
  }

  private _visualCommandToFrames(command: VisualCommand): PresentationDownstreamFrame[] {
    const frames: PresentationDownstreamFrame[] = [];
    const base = {
      trace_id: command.trace_id,
      timestamp: command.timestamp || Date.now(),
    };

    if (command.emotion_state?.emotion_type) {
      frames.push({
        ...base,
        kind: 'emotion',
        emotion: {
          emotion_type: command.emotion_state.emotion_type,
          intensity: command.emotion_state.intensity ?? 0.5,
          trigger: command.emotion_state.trigger ?? '',
        },
      });
    }

    if (command.expression) {
      frames.push({ ...base, kind: 'expression', expression: command.expression });
    }

    if (command.motion) {
      frames.push({
        ...base,
        kind: 'motion',
        motion: {
          motion_id: command.motion.motion_id,
          loop: command.motion.loop,
          priority: command.motion.priority,
        },
      });
    }

    for (const parameter of command.parameter?.parameters ?? []) {
      frames.push({
        ...base,
        kind: 'parameter',
        parameter: {
          param_id: parameter.name,
          value: parameter.value,
          fade_ms: command.parameter?.blend_time_ms,
        },
      });
    }

    if (command.audio) {
      frames.push({
        ...base,
        kind: 'audio_play',
        audio_play: {
          audio_id: command.audio.audio_id,
          audio_uri: command.audio.audio_uri ?? undefined,
          audio_data: command.audio.audio_data ?? undefined,
          mime_type: command.audio.mime_type,
          duration_ms: command.audio.duration_ms,
        },
      });
    }

    if (command.command_type === 'idle') {
      frames.push({ ...base, kind: 'idle' });
    }

    if (frames.length === 0 && command.command_type !== 'lip_sync') {
      logger.debug('VisualCommand 没有可映射载荷', { command_type: command.command_type });
    }

    return frames;
  }
}

function waitForWebSocketServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    const onListening = (): void => { cleanup(); resolve(); };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const cleanup = (): void => {
      server.off('listening', onListening);
      server.off('error', onError);
    };
    server.once('listening', onListening);
    server.once('error', onError);
  });
}
