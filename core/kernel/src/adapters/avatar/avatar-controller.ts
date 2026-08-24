import * as grpc from '@grpc/grpc-js';
import { randomBytes } from 'node:crypto';
import { EventBus } from '../events/event-bus';
import { getLogger } from '../observability/logger';
import {
  VisualCommandDispatchEvent,
  AvatarActionStateChangedEvent,
  AvatarStatusChangedEvent,
} from '../../domain/events';
import type { VisualCommand } from '../../domain/kernel-contracts';
import type { AvatarConfig } from '@glimmer-cradle/protocol';
import { create } from '@bufbuild/protobuf';
import {
  AudioPlayPayloadSchema,
  AvatarDownstreamFrameSchema,
  AvatarExpressionPayloadSchema,
  AvatarIntentPayloadSchema,
  AvatarLipSyncPayloadSchema,
  AvatarMotionPayloadSchema,
  AvatarParameterPayloadSchema,
  AvatarPresentationPayloadSchema,
  AvatarUpstreamFrameSchema,
  CharacterPresentationAppearancePayloadSchema,
  CharacterPresentationLifecyclePayloadSchema,
  CharacterPresentationProjectionPayloadSchema,
  EmotionPayloadSchema,
  LoadScenePayloadSchema,
  ThoughtPayloadSchema,
  UnloadScenePayloadSchema,
} from '@glimmer-cradle/contracts/glimmer/avatar/v1/avatar_host_pb';
import type {
  AvatarDownstreamFrame,
  AvatarUpstreamFrame,
} from '@glimmer-cradle/contracts/glimmer/avatar/v1/avatar_host_pb';
import type {
  PresentationDownstreamFrame,
  PresentationUpstreamFrame,
  CharacterPresentationProjectionPayload,
  AvatarHostHelloPayload,
  AvatarHostReadyPayload,
} from './avatar-control-model';
import type { RuntimeReadinessSnapshot } from '../../ports/runtime-readiness.port';
import {
  strongestRuntimeResourceState,
  type RuntimeResourceSnapshot,
} from '../../ports/runtime-reconciliation.port';
import type { RuntimeProjectionInputPort } from '../../ports/kernel-lifecycle.port';
import { UnityAvatarHostProcess } from './unity-avatar-host-process';
import { buildAvatarResourceSnapshots } from './avatar-resource-catalog';
import { EndpointRegistry } from '../endpoints/endpoint-registry';
import { duplexStreamingMethod } from '../cognition/grpc-contract';

const logger = getLogger('avatar-engine');
const AVATAR_RUNTIME_MODULE_NAME = 'avatar-runtime';
const AVATAR_AUTH_METADATA = 'x-glimmer-avatar-token';
const avatarHostDefinition = {
  Connect: duplexStreamingMethod(
    '/glimmer.avatar.v1.AvatarHostService/Connect',
    AvatarUpstreamFrameSchema,
    AvatarDownstreamFrameSchema,
  ),
};
type AvatarStream = grpc.ServerDuplexStream<AvatarUpstreamFrame, AvatarDownstreamFrame>;

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
  private _server: grpc.Server | null = null;
  private _serverAddress: string | null = null;
  private readonly _clients: Set<AvatarStream> = new Set();
  private readonly _readyClients: Set<AvatarStream> = new Set();
  private readonly _lastHeartbeatByClient: Map<AvatarStream, number> = new Map();
  private readonly _lastErrorByClient: Map<AvatarStream, string> = new Map();
  private _authToken = '';
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

  public constructor(private readonly readinessProjection: RuntimeProjectionInputPort) {}

  public async init(config: AvatarConfig): Promise<void> {
    if (this._initialized) return;

    this._config = config;
    this._heartbeatIntervalMs = config.heartbeat_interval_ms;
    this._heartbeatTimeoutMs = config.heartbeat_timeout_ms;
    this._disposeProcessSubscription = UnityAvatarHostProcess.instance.subscribe(() => {
      this._syncRuntimeReadiness();
    });
    this._authToken = randomBytes(32).toString('hex');
    const server = new grpc.Server({
      'grpc.max_receive_message_length': 2 * 1024 * 1024,
      'grpc.max_send_message_length': 2 * 1024 * 1024,
    });
    server.addService(avatarHostDefinition, {
      Connect: this._connectAvatar.bind(this),
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, boundPort) => {
        if (error) reject(error);
        else resolve(boundPort);
      });
    });
    this._server = server;
    this._serverAddress = `127.0.0.1:${port}`;
    const endpoint = `grpc://127.0.0.1:${port}`;
    await EndpointRegistry.instance.publish('avatar-host', endpoint);
    UnityAvatarHostProcess.instance.configure(config.host, endpoint, this._authToken);

    EventBus.instance.subscribe('VisualCommandDispatchEvent', async (event: any) => {
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
    for (const client of this._clients) {
      this._sendFrame(client, shutdownFrame);
      client.end();
    }

    await UnityAvatarHostProcess.instance.stop();

    if (this._server) {
      const server = this._server;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          server.forceShutdown();
          resolve();
        }, 2000);
        server.tryShutdown(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      this._server = null;
      this._serverAddress = null;
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
    this._authToken = '';
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
    if (frame.kind !== 'presentation') {
      logger.debug('向 Avatar 广播帧', {
        frame_class: 'avatar-control',
        kind: frame.kind,
        trace_id: frame.trace_id,
      });
    }

    for (const client of this._readyClients) {
      this._sendFrame(client, frame);
    }
  }

  public async sendVisualCommand(command: VisualCommand): Promise<boolean> {
    if (!this.isRendererConnected) return false;

    for (const frame of this._visualCommandToFrames(command)) {
      this.broadcastFrame(frame);
    }
    return true;
  }

  private _connectAvatar(call: AvatarStream): void {
    const suppliedToken = call.metadata.get(AVATAR_AUTH_METADATA)[0];
    if (typeof suppliedToken !== 'string' || suppliedToken !== this._authToken) {
      call.emit('error', Object.assign(new Error('Avatar Host 认证失败'), {
        code: grpc.status.PERMISSION_DENIED,
        details: 'avatar_auth_failed',
        metadata: new grpc.Metadata(),
      }));
      return;
    }

    logger.info('Avatar 已连接');
    this._clients.add(call);
    this._lastHeartbeatByClient.set(call, Date.now());
    this._emitStatusIfChanged('connected');

    call.on('data', (message: AvatarUpstreamFrame) => {
      try {
        this._handleUpstream(decodeUpstream(message), call);
      } catch (error) {
        logger.warn('拒绝无效 Avatar gRPC 帧', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    const cleanup = (): void => {
      if (!this._clients.delete(call)) return;
      logger.warn('Avatar 已断开');
      this._readyClients.delete(call);
      this._lastHeartbeatByClient.delete(call);
      this._lastErrorByClient.delete(call);
      this._emitStatusIfChanged('disconnected');
    };
    call.on('end', () => {
      cleanup();
      call.end();
    });
    call.on('close', cleanup);
    call.on('cancelled', cleanup);
    call.on('error', (err: Error) => {
      logger.error('Avatar gRPC stream 错误', { err });
      cleanup();
    });
  }

  private _handleUpstream(frame: PresentationUpstreamFrame, client: AvatarStream): void {
    if (!frame || typeof frame.kind !== 'string') {
      logger.warn('Avatar 发送了无效帧');
      return;
    }

    this._lastHeartbeatByClient.set(client, Date.now());

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
          this._readyClients.add(client);
          this._lastErrorByClient.delete(client);
          logger.info('Avatar 已完成首帧呈现并就绪', {
            model_id: readyPayload?.model_id,
            avatar_package_id: readyPayload?.avatar_package_id,
          });
        } else {
          this._readyClients.delete(client);
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
          new AvatarActionStateChangedEvent({
            active_action_ids: frame.avatar_action_state.active_action_ids ?? [],
          }),
        ).catch((err: any) => logger.error('AvatarActionStateChangedEvent publish 失败', { err }));
        break;
      case 'error':
        this._lastErrorByClient.set(
          client,
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
    for (const client of this._clients) {
      this._sendFrame(client, pingFrame);

      if (!this._readyClients.has(client)) continue;
      const lastHeartbeat = this._lastHeartbeatByClient.get(client) ?? 0;
      if (now - lastHeartbeat > this._heartbeatTimeoutMs) {
        logger.warn('Avatar 心跳超时，标记为未就绪');
        this._readyClients.delete(client);
        this._emitStatusIfChanged('heartbeat_timeout');
      }
    }
  }

  private _sendFrame(client: AvatarStream, frame: PresentationDownstreamFrame): void {
    if (client.cancelled || client.destroyed) return;
    if (!client.write(encodeDownstream(frame))) {
      logger.warn('Avatar gRPC stream 进入背压，暂停 ready 投递');
      this._readyClients.delete(client);
      this._emitStatusIfChanged('heartbeat_timeout');
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
    ).catch((err: any) => logger.error('AvatarStatusChangedEvent publish 失败', { err }));
  }

  private _syncRuntimeReadiness(): void {
    if (!this._config) return;
    this.readinessProjection.replaceModuleSnapshots(
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

function encodeDownstream(frame: PresentationDownstreamFrame): AvatarDownstreamFrame {
  const base = {
    kind: frame.kind,
    traceId: frame.trace_id ?? '',
    timestamp: frame.timestamp,
  };

  switch (frame.kind) {
    case 'shutdown':
    case 'ping':
    case 'idle':
      return create(AvatarDownstreamFrameSchema, base);
    case 'emotion': {
      const payload = requirePayload(frame.emotion, frame.kind);
      return create(AvatarDownstreamFrameSchema, {
        ...base,
        emotion: create(EmotionPayloadSchema, {
          emotionType: payload.emotion_type,
          intensity: payload.intensity,
          trigger: payload.trigger ?? '',
          blendTimeMs: payload.blend_time_ms ?? 0,
        }),
      });
    }
    case 'thought': {
      const payload = requirePayload(frame.thought, frame.kind);
      return create(AvatarDownstreamFrameSchema, {
        ...base,
        thought: create(ThoughtPayloadSchema, {
          active: payload.active,
          hint: payload.hint ?? '',
        }),
      });
    }
    case 'audio_play': {
      const payload = requirePayload(frame.audio_play, frame.kind);
      if (payload.audio_data) {
        throw new Error('Avatar control plane 不接受内联 audio_data');
      }
      return create(AvatarDownstreamFrameSchema, {
        ...base,
        audioPlay: create(AudioPlayPayloadSchema, {
          audioId: payload.audio_id,
          audioUri: payload.audio_uri ?? '',
          mimeType: payload.mime_type ?? '',
          durationMs: payload.duration_ms ?? 0,
        }),
      });
    }
    case 'expression': {
      const payload = requirePayload(frame.expression, frame.kind);
      return create(AvatarDownstreamFrameSchema, {
        ...base,
        expression: create(AvatarExpressionPayloadSchema, {
          expressionId: payload.expression_id,
          blendTimeMs: payload.blend_time_ms ?? 0,
          autoReset: payload.auto_reset ?? false,
        }),
      });
    }
    case 'motion': {
      const payload = requirePayload(frame.motion, frame.kind);
      return create(AvatarDownstreamFrameSchema, {
        ...base,
        motion: create(AvatarMotionPayloadSchema, {
          motionId: payload.motion_id,
          loop: payload.loop ?? false,
          priority: payload.priority ?? 0,
        }),
      });
    }
    case 'lip_sync': {
      const payload = requirePayload(frame.lip_sync, frame.kind);
      return create(AvatarDownstreamFrameSchema, {
        ...base,
        lipSync: create(AvatarLipSyncPayloadSchema, {
          amplitude: payload.amplitude,
          source: payload.source ?? '',
        }),
      });
    }
    case 'parameter': {
      const payload = requirePayload(frame.parameter, frame.kind);
      return create(AvatarDownstreamFrameSchema, {
        ...base,
        parameter: create(AvatarParameterPayloadSchema, {
          paramId: payload.param_id,
          value: payload.value,
          fadeMs: payload.fade_ms ?? 0,
        }),
      });
    }
    case 'avatar_intent': {
      const payload = requirePayload(frame.avatar_intent, frame.kind);
      return create(AvatarDownstreamFrameSchema, {
        ...base,
        avatarIntent: create(AvatarIntentPayloadSchema, {
          actionId: payload.action_id,
          operation: payload.operation,
          source: payload.source,
          priority: payload.priority ?? 0,
        }),
      });
    }
    case 'presentation': {
      const payload = requirePayload(frame.presentation, frame.kind);
      return create(AvatarDownstreamFrameSchema, {
        ...base,
        presentation: create(AvatarPresentationPayloadSchema, {
          placementId: payload.placement_id ?? '',
          displayScale: payload.display_scale ?? 0,
          resetPlacement: payload.reset_placement ?? false,
        }),
      });
    }
    case 'character_presentation_projection': {
      const payload = requirePayload(frame.character_presentation_projection, frame.kind);
      return create(AvatarDownstreamFrameSchema, {
        ...base,
        characterPresentationProjection: create(CharacterPresentationProjectionPayloadSchema, {
          avatarPackageId: payload.avatar_package_id,
          modelId: payload.model_id,
          displayName: payload.display_name,
          kind: payload.kind,
          backend: payload.backend,
          hostKind: payload.host_kind,
          avatarState: payload.avatar_state,
          appearance: create(CharacterPresentationAppearancePayloadSchema, {
            placementId: payload.appearance.placement_id ?? '',
            displayScale: payload.appearance.display_scale,
          }),
          lifecycle: create(CharacterPresentationLifecyclePayloadSchema, {
            workerWindowState: payload.lifecycle.worker_window_state,
            compositionSurfaceState: payload.lifecycle.composition_surface_state,
            firstFramePresented: payload.lifecycle.first_frame_presented,
            interactionReady: payload.lifecycle.interaction_ready,
            ready: payload.lifecycle.ready,
            summary: payload.lifecycle.summary,
          }),
        }),
      });
    }
    case 'load_scene': {
      const payload = requirePayload(frame.load_scene, frame.kind);
      return create(AvatarDownstreamFrameSchema, {
        ...base,
        loadScene: create(LoadScenePayloadSchema, {
          sceneId: payload.scene_id,
          fadeMs: payload.fade_ms ?? 0,
        }),
      });
    }
    case 'unload_scene': {
      const payload = requirePayload(frame.unload_scene, frame.kind);
      return create(AvatarDownstreamFrameSchema, {
        ...base,
        unloadScene: create(UnloadScenePayloadSchema, {
          fadeMs: payload.fade_ms ?? 0,
        }),
      });
    }
    default:
      throw new Error(`AvatarHostService 不支持下行帧 ${frame.kind}`);
  }
}

function decodeUpstream(message: AvatarUpstreamFrame): PresentationUpstreamFrame {
  if (!message.kind || message.timestamp === undefined || !Number.isFinite(message.timestamp)) {
    throw new Error('Avatar 上行帧缺少 kind 或有效 timestamp');
  }
  assertExpectedUpstreamPayload(message);
  const base = {
    kind: message.kind,
    trace_id: message.traceId || undefined,
    timestamp: message.timestamp,
  };

  switch (message.kind) {
    case 'heartbeat':
    case 'pong':
      return base as PresentationUpstreamFrame;
    case 'host_hello': {
      const payload = requirePayload(message.hostHello, message.kind);
      if (payload.hostKind !== 'unity') throw new Error('Avatar host_hello.host_kind 必须为 unity');
      return {
        ...base,
        kind: 'host_hello',
        host_hello: {
          host_kind: 'unity',
          host_id: payload.hostId || undefined,
          host_version: payload.hostVersion || undefined,
          capabilities: payload.capabilities as NonNullable<AvatarHostHelloPayload['capabilities']>,
          model_id: payload.modelId || undefined,
          avatar_package_id: payload.avatarPackageId || undefined,
        },
      };
    }
    case 'host_ready': {
      const payload = requirePayload(message.hostReady, message.kind);
      if (payload.firstFramePresented === undefined || payload.interactionReady === undefined) {
        throw new Error('host_ready 缺少 first_frame_presented 或 interaction_ready');
      }
      return {
        ...base,
        kind: 'host_ready',
        host_ready: {
          host_id: payload.hostId || undefined,
          model_id: payload.modelId || undefined,
          avatar_package_id: payload.avatarPackageId || undefined,
          worker_window_state: payload.workerWindowState as AvatarHostReadyPayload['worker_window_state'],
          composition_surface_state: payload.compositionSurfaceState as AvatarHostReadyPayload['composition_surface_state'],
          first_frame_presented: payload.firstFramePresented,
          interaction_ready: payload.interactionReady,
          summary: payload.summary ?? '',
        },
      };
    }
    case 'avatar_action_state': {
      const payload = requirePayload(message.avatarActionState, message.kind);
      return {
        ...base,
        kind: 'avatar_action_state',
        avatar_action_state: {
          action_id: payload.actionId || undefined,
          state: payload.state ? payload.state as NonNullable<PresentationUpstreamFrame['avatar_action_state']>['state'] : undefined,
          active_action_ids: [...payload.activeActionIds],
          message: payload.message || undefined,
        },
      };
    }
    case 'animation_complete': {
      const payload = requirePayload(message.animationComplete, message.kind);
      return {
        ...base,
        kind: 'animation_complete',
        animation_complete: { animation_id: payload.animationId ?? '' },
      };
    }
    case 'error': {
      const payload = requirePayload(message.error, message.kind);
      return {
        ...base,
        kind: 'error',
        error: { code: payload.code ?? '', message: payload.message ?? '' },
      };
    }
    default:
      throw new Error(`AvatarHostService 不支持上行帧 ${message.kind}`);
  }
}

function requirePayload<T>(payload: T | null | undefined, kind: string): T {
  if (payload === null || payload === undefined) {
    throw new Error(`${kind} 缺少契约 payload`);
  }
  return payload;
}

function assertExpectedUpstreamPayload(message: AvatarUpstreamFrame): void {
  const payloads = [
    ['host_hello', message.hostHello],
    ['host_ready', message.hostReady],
    ['avatar_action_state', message.avatarActionState],
    ['animation_complete', message.animationComplete],
    ['error', message.error],
  ].filter(([, value]) => value !== undefined);
  const expected = message.kind === 'heartbeat' || message.kind === 'pong' ? null : message.kind;
  if (expected === null) {
    if (payloads.length > 0) throw new Error(`${message.kind} 不允许携带 payload`);
    return;
  }
  if (payloads.length !== 1 || payloads[0]?.[0] !== expected) {
    throw new Error(`${message.kind} 的 payload 缺失或不匹配`);
  }
}
