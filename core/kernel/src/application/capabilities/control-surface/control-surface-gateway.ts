import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { EventBus } from '../../../foundation/event-bus/event-bus';
import { getLogger } from '../../../foundation/logger/logger';
import { RuntimeReadinessCatalogStore } from '../../../foundation/runtime-readiness-catalog';
import { resolveWorkDir } from '../../../foundation/utils/path-utils';
import { PerceptionAppService } from '../../services/perception-app.service';
import { AvatarController } from '../avatar/avatar-controller';
import { isLocalAvatarSurfaceScene } from '../action-stream/surface-scene-scope';
import { EXTENSION_ID_PATTERN, getPresentationFrameClass, PerceptionEvent } from '@glimmer-cradle/protocol';
import { AudioService } from '../audio/audio-service';
import { SkillCatalogAppService } from '../../services/skill-catalog-app.service';
import type { ConfigApplicationService } from '../../services/config-application.service';
import { ConversationHistoryService } from './conversation-history-service';
import {
  ActionStreamCancelledEvent,
  ActionStreamStartedEvent,
  AvatarActionStateChangedEvent,
  AvatarStatusChangedEvent,
  ChannelReplyEvent,
  ExtensionErrorEvent,
  ExtensionLoadedEvent,
  ExtensionStartedEvent,
  ExtensionStoppedEvent,
} from '../../../foundation/event-bus/events';
import type {
  PresentationUpstreamFrame,
  PresentationDownstreamFrame,
  AudioStatusPayload,
  ChannelReplyMessage,
  ConversationHistoryRequest,
  ControlSurfaceGatewayConfig,
  ConfigurationSnapshotRequest,
  ConfigurationTestRequest,
  ConfigurationUpdateRequest,
  ExtensionInstallCommitRequest,
  ExtensionInstallPrepareRequest,
  ExtensionCommandRequest,
  ExtensionInstallationProjection,
  ExtensionLifecycleRequest,
  ExtensionRuntimeProjection,
  ExtensionRuntimeProjectionRequest,
  ExtensionUninstallRequest,
  RuntimeReadinessCatalog,
} from '@glimmer-cradle/protocol';
import type { SkillConfirmationRequest } from '../../skill-plane/skill-invocation-gateway';
import { EndpointRegistry } from '../../../foundation/endpoints/endpoint-registry';

const logger = getLogger('control-surface-gateway');
type SkillCatalogRequestPayload = NonNullable<PresentationUpstreamFrame['skill_catalog_request']>;
type SkillCatalogResponsePayload = NonNullable<PresentationDownstreamFrame['skill_catalog_response']>;

/**
 * Kernel 侧可确认的 Avatar Host 状态。
 *
 * Kernel 只上报自己能够验证的事实：
 *   - `unity`：UnityAvatarHost 已通过 readiness gates；
 *   - `offline`：Avatar Host 未就绪，桌面端显示等待或降级状态。
 */
export type KernelAvatarStatus = 'unity' | 'offline';

interface ExtensionLifecycleController {
  loadExtension(extensionId: string): Promise<void>;
  startExtension(extensionId: string): Promise<void>;
  stopExtension(extensionId: string): Promise<void>;
  activateExtension(extensionId: string, version?: string): Promise<void>;
  deactivateExtension(extensionId: string): Promise<void>;
  prepareInstall(source: ExtensionInstallPrepareRequest['source']): Promise<{
    transaction_id: string;
    extension: {
      id: string;
      name: string;
      version: string;
      publisher: string;
      description?: string;
      permissions: string[];
      platforms: string[];
    };
    artifact: { sha256: string; size: number; platform: string };
    trust: NonNullable<PresentationDownstreamFrame['extension_install_preview']>['trust'];
  }>;
  commitInstall(transactionId: string, approvedPermissions: string[]): Promise<{
    extension_id: string;
    version: string;
    already_installed: boolean;
  }>;
  cancelInstall(transactionId: string): Promise<void>;
  uninstall(extensionId: string, version: string): Promise<void>;
  executeCommand(commandId: string, ...args: unknown[]): Promise<unknown>;
  listRuntimeProjections(): ExtensionRuntimeProjection[];
  listInstallationProjections(): ExtensionInstallationProjection[];
  getRuntimeProjection(extensionId: string): ExtensionRuntimeProjection | undefined;
}

interface PendingSurfaceRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class ControlSurfaceGateway {
  private static _instance: ControlSurfaceGateway | null = null;
  private _wss: WebSocketServer | null = null;
  private _clients: Set<WebSocket> = new Set();
  private _initialized = false;
  private _perceptionAppService: PerceptionAppService | null = null;
  private _skillCatalogAppService: SkillCatalogAppService | null = null;
  private _lastAvatarRenderState: KernelAvatarStatus = 'offline';
  private _lastAvatarActionState: NonNullable<PresentationDownstreamFrame['avatar_action_state']> | null = null;
  private _requestApplicationShutdown: ((reason: string) => Promise<void>) | null = null;
  private _extensionLifecycleController: ExtensionLifecycleController | null = null;
  private _configApplicationService: ConfigApplicationService | null = null;
  private _conversationHistoryService: ConversationHistoryService | null = null;
  private _disposeRuntimeReadinessSubscription: (() => void) | null = null;
  private readonly _pendingSurfaceRequests = new Map<string, PendingSurfaceRequest>();
  // Avatar status 由 AvatarStatusChangedEvent 驱动，不由 UI 定时推断。

  public static get instance(): ControlSurfaceGateway {
    if (!ControlSurfaceGateway._instance) {
      ControlSurfaceGateway._instance = new ControlSurfaceGateway();
    }
    return ControlSurfaceGateway._instance;
  }

  private constructor() {}

  public async init(
    perceptionAppService: PerceptionAppService,
    skillCatalogAppService: SkillCatalogAppService,
    config: ControlSurfaceGatewayConfig,
    requestApplicationShutdown: (reason: string) => Promise<void>,
  ): Promise<void> {
    if (this._initialized) return;

    this._perceptionAppService = perceptionAppService;
    this._skillCatalogAppService = skillCatalogAppService;
    this._requestApplicationShutdown = requestApplicationShutdown;
    this._wss = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 2 * 1024 * 1024 });
    await waitForWebSocketServer(this._wss);
    const address = this._wss.address() as AddressInfo;
    await EndpointRegistry.instance.publish('control-surface', `ws://127.0.0.1:${address.port}`);

    this._wss.on('connection', (ws: WebSocket) => {
      logger.info('产品控制表面已连接');
      this._clients.add(ws);
      // 阶段 8.3:首帧用 PresentationDownstreamFrame(kind=avatar_status)
      this._sendFrame(ws, {
        kind: 'avatar_status',
        timestamp: Date.now(),
        avatar_status: { host_kind: this._getAvatarRenderState() },
      });
      // null 表示本轮生命周期尚未收到 Shell 权威状态，不能用默认空数组
      // 覆盖 Desktop 已持久化的用户动作偏好。
      if (this._lastAvatarActionState) {
        this._sendFrame(ws, {
          kind: 'avatar_action_state',
          timestamp: Date.now(),
          avatar_action_state: this._lastAvatarActionState,
        });
      }
      this._sendFrame(ws, {
        kind: 'character_presentation_projection',
        timestamp: Date.now(),
        character_presentation_projection: AvatarController.instance.getCharacterPresentationProjection(),
      });
      this._sendRuntimeReadiness(ws, RuntimeReadinessCatalogStore.instance.getCatalog());
      void this._sendAudioStatus(ws);

      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          this._handleMessage(data, ws);
        } catch (err) {
          logger.warn('Failed to parse message', { message: message.toString() });
        }
      });

      ws.on('close', () => {
        logger.info('产品控制表面已断开');
        this._clients.delete(ws);
      });

      ws.on('error', (err) => {
        logger.error('产品控制表面 WebSocket 异常', { err });
      });
    });

    EventBus.instance.subscribe('ActionStreamStartedEvent', async (event: any) => {
      const started = event as ActionStreamStartedEvent;
      const { scene_id: sceneId, stream_id: streamId, stage } = started.payload;
      if (!this._isDesktopScene(sceneId)) {
        return;
      }

      this.broadcastFrame({
        kind: 'thought',
        trace_id: streamId,
        timestamp: Date.now(),
        thought: {
          active: true,
          hint: stage === 'thinking' ? '正在思考…' : '正在回应…',
        },
      });
      this._conversationHistoryService?.updateThought(streamId, true);
    });

    EventBus.instance.subscribe('ActionStreamCancelledEvent', async (event: any) => {
      const cancelled = event as ActionStreamCancelledEvent;
      const { scene_id: sceneId, stream_id: streamId } = cancelled.payload;
      if (!this._isDesktopScene(sceneId)) {
        return;
      }

      this.broadcastFrame({
        kind: 'thought',
        trace_id: streamId,
        timestamp: Date.now(),
        thought: { active: false },
      });
      this._conversationHistoryService?.updateThought(streamId, false);
    });

    EventBus.instance.subscribe('action.channel.reply', async (event: any) => {
      const reply = event as ChannelReplyEvent;
      const { trace_id: traceId, text, messages, emotion_state: emotionState, target_channel: targetChannel } = reply.payload;

      // 阶段 8.4：只认显式 target_channel，旧 `trace_id.startsWith('ui_')`
      // 路由 fallback 已删除。
      const matchesDesktopUI = isLocalAvatarSurfaceScene(targetChannel);

      if (matchesDesktopUI) {
        this._conversationHistoryService?.recordReply(traceId, text);
        this.broadcastFrame({
          kind: 'thought',
          trace_id: traceId,
          timestamp: Date.now(),
          thought: { active: false },
        });
        // 阶段 8.3:发 PresentationDownstreamFrame —— reply 与 emotion 分帧
        // (消 smell H,emotion 不再塞在 reply 里)。trace_id 真实贯通,不在
        // 渲染边界重新捏造(消 smell C)。
        this.broadcastFrame({
          kind: 'reply',
          trace_id: traceId,
          timestamp: Date.now(),
          reply: { text, messages },
        });
        this._speakReply(traceId, text, messages);
        if (emotionState && typeof emotionState === 'object') {
          const e = emotionState as { emotion_type?: string; intensity?: number; trigger?: string };
          if (typeof e.emotion_type === 'string' && typeof e.intensity === 'number') {
            this.broadcastFrame({
              kind: 'emotion',
              trace_id: traceId,
              timestamp: Date.now(),
              emotion: {
                emotion_type: e.emotion_type,
                intensity: e.intensity,
                trigger: e.trigger ?? '',
              },
            });
          }
        }
      }
    });

    // 阶段 8.2:事件驱动 shell status 取代 1500ms 轮询(消 smell E)。
    // AvatarController 在 Unity 连/断/心跳超时时 publish
    // AvatarStatusChangedEvent;这里订阅后立即转发到 Electron 端,无抖动延迟。
    EventBus.instance.subscribe('AvatarStatusChangedEvent', async (event: any) => {
      const e = event as AvatarStatusChangedEvent;
      const { hostKind } = e.payload;
      const projectionFrame: PresentationDownstreamFrame = {
        kind: 'character_presentation_projection',
        timestamp: Date.now(),
        character_presentation_projection: AvatarController.instance.getCharacterPresentationProjection(),
      };
      this.broadcastFrame(projectionFrame);
      AvatarController.instance.broadcastFrame(projectionFrame);
      if (hostKind !== this._lastAvatarRenderState) {
        this._lastAvatarRenderState = hostKind;
        this.broadcastFrame({
          kind: 'avatar_status',
          timestamp: Date.now(),
          avatar_status: { host_kind: hostKind },
        });
      }
    });

    EventBus.instance.subscribe('AvatarActionStateChangedEvent', async (event: any) => {
      const actionState = (event as AvatarActionStateChangedEvent).payload;
      this._lastAvatarActionState = actionState;
      this.broadcastFrame({
        kind: 'avatar_action_state',
        timestamp: Date.now(),
        avatar_action_state: actionState,
      });
    });

    const broadcastExtensionStatusChanged = (
      eventName: 'loaded' | 'started' | 'stopped' | 'error',
      payload: unknown,
    ): void => {
      if (!payload || typeof payload !== 'object') return;
      const value = payload as Record<string, unknown>;
      const extensionId = typeof value.extensionId === 'string' ? value.extensionId : '';
      if (!extensionId) return;

      this.broadcast(JSON.stringify({
        kind: 'extension_status_changed',
        timestamp: Date.now(),
        extension_status_changed: {
          extension_id: extensionId,
          event: eventName,
          message: typeof value.error === 'string' ? value.error : undefined,
        },
      }));
      const projection = this._extensionLifecycleController?.getRuntimeProjection(extensionId);
      if (projection) {
        this.broadcastFrame({
          kind: 'extension_runtime_projection_changed',
          timestamp: Date.now(),
          extension_runtime_projection_changed: projection,
        });
      }
    };

    EventBus.instance.subscribe('ExtensionLoadedEvent', async (event: any) => {
      broadcastExtensionStatusChanged('loaded', (event as ExtensionLoadedEvent).payload);
    });
    EventBus.instance.subscribe('ExtensionStartedEvent', async (event: any) => {
      broadcastExtensionStatusChanged('started', (event as ExtensionStartedEvent).payload);
    });
    EventBus.instance.subscribe('ExtensionStoppedEvent', async (event: any) => {
      broadcastExtensionStatusChanged('stopped', (event as ExtensionStoppedEvent).payload);
    });
    EventBus.instance.subscribe('ExtensionErrorEvent', async (event: any) => {
      broadcastExtensionStatusChanged('error', (event as ExtensionErrorEvent).payload);
    });

    this._disposeRuntimeReadinessSubscription = RuntimeReadinessCatalogStore.instance.subscribe((catalog) => {
      this.broadcastFrame({
        kind: 'runtime_readiness',
        timestamp: Date.now(),
        runtime_readiness: catalog,
      });
    });

    this._initialized = true;
    logger.info('ControlSurfaceGateway started', { endpoint: `ws://127.0.0.1:${address.port}` });
  }

  private _getAvatarRenderState(): KernelAvatarStatus {
    return AvatarController.instance.isRendererConnected
      ? 'unity'
      : 'offline';
  }

  public setExtensionLifecycleController(controller: ExtensionLifecycleController | null): void {
    this._extensionLifecycleController = controller;
  }

  public setConfigApplicationService(service: ConfigApplicationService | null): void {
    this._configApplicationService = service;
  }

  public setConversationHistoryService(service: ConversationHistoryService | null): void {
    this._conversationHistoryService = service;
  }

  private _isDesktopScene(sceneId: string): boolean {
    return isLocalAvatarSurfaceScene(sceneId);
  }

  private broadcast(data: string) {
    for (const client of this._clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /** 阶段 8.3:统一 PresentationDownstreamFrame 序列化广播。 */
  public broadcastFrame(frame: PresentationDownstreamFrame): void {
    logger.debug('Broadcast PresentationFrame', {
      frame_class: getPresentationFrameClass(frame.kind),
      kind: frame.kind,
      trace_id: frame.trace_id,
    });

    this.broadcast(JSON.stringify(frame));
  }

  public async requestCoreSkillAction(action: string, payload: Record<string, unknown>): Promise<unknown> {
    return this._requestSurfaceRoundTrip('core_skill_action_request', {
      action,
      payload,
    });
  }

  public async requestSkillConfirmation(request: SkillConfirmationRequest): Promise<boolean> {
    const result = await this._requestSurfaceRoundTrip('core_skill_confirmation_request', {
      confirmation: {
        trace_id: request.traceId,
        skill_id: request.skillId,
        target_kind: request.targetKind,
        target_name: request.targetName,
        risk_level: request.riskLevel,
        side_effects: request.sideEffects,
      },
    });
    return Boolean((result as { approved?: unknown })?.approved);
  }

  private _requestSurfaceRoundTrip(kind: string, payload: Record<string, unknown>): Promise<unknown> {
    const client = Array.from(this._clients).find((item) => item.readyState === WebSocket.OPEN);
    if (!client) {
      return Promise.reject(new Error('产品控制表面未连接，无法执行本地 Skill'));
    }

    const requestId = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingSurfaceRequests.delete(requestId);
        reject(new Error('产品控制表面本地 Skill 请求超时'));
      }, 30000);
      this._pendingSurfaceRequests.set(requestId, { resolve, reject, timer });
      client.send(JSON.stringify({
        kind,
        request_id: requestId,
        timestamp: Date.now(),
        ...payload,
      }));
    });
  }

  /** 阶段 8.3：对单个 client 发帧（首帧 avatar_status 使用）。 */
  private _speechGeneration = 0;

  private _speakReply(traceId: string, text: string, messages?: ChannelReplyMessage[]): void {
    const speakableText = this._selectSpeakableText(text, messages);
    if (!speakableText) return;

    const generation = ++this._speechGeneration;
    void this._synthesizeAndBroadcastSpeech(traceId, speakableText, generation);
  }

  private async _synthesizeAndBroadcastSpeech(traceId: string, text: string, generation: number): Promise<void> {
    const chunks = this._splitSpeakableText(text);
    for (let index = 0; index < chunks.length; index += 1) {
      if (generation !== this._speechGeneration) return;
      await this._synthesizeAndBroadcastAudio(traceId, chunks[index], index);
    }
  }

  private async _synthesizeAndBroadcastAudio(traceId: string, text: string, sequence = 0): Promise<void> {
    try {
      const result = await AudioService.instance.synthesizeSpeech({ text, trace_id: traceId });
      if (result.status !== 'success' || !result.output_path) {
        logger.warn('TTS synthesis skipped audio_play', {
          trace_id: traceId,
          reason: result.message ?? 'unknown',
        });
        return;
      }

      const audioBuffer = await readFile(result.output_path);
      const maxInlineBytes = 8 * 1024 * 1024;

      this.broadcastFrame({
        kind: 'audio_play',
        trace_id: traceId,
        timestamp: Date.now(),
        audio_play: {
          audio_id: `reply-${traceId}-${sequence}`,
          audio_uri: pathToFileURL(result.output_path).toString(),
          audio_data: audioBuffer.length <= maxInlineBytes
            ? audioBuffer.toString('base64')
            : undefined,
          mime_type: 'audio/wav',
        },
      });
    } catch (error) {
      logger.warn('Failed to synthesize reply audio', {
        trace_id: traceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private _selectSpeakableText(text: string, messages?: ChannelReplyMessage[]): string {
    if (Array.isArray(messages) && messages.length > 0) {
      const parts = messages
        .filter((message) => message.content_type === 'text')
        .map((message) => message.text.trim())
        .filter(Boolean);
      if (parts.length > 0) {
        return parts.join('\n');
      }
    }

    return text.trim();
  }

  private _splitSpeakableText(text: string): string[] {
    const normalized = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return [];
    if (normalized.length <= 48) return [normalized];

    const chunks = normalized.match(/[^。！？!?；;，,]{1,64}[。！？!?；;，,]?/g) ?? [normalized];
    const merged: string[] = [];
    for (const chunk of chunks.map((part) => part.trim()).filter(Boolean)) {
      const last = merged[merged.length - 1];
      if (last && last.length + chunk.length < 24) {
        merged[merged.length - 1] = `${last}${chunk}`;
      } else {
        merged.push(chunk);
      }
    }
    return merged.slice(0, 8);
  }

  private _sendFrame(ws: WebSocket, frame: PresentationDownstreamFrame): void {
    if (ws.readyState === WebSocket.OPEN) {
      logger.debug('Send PresentationFrame', {
        frame_class: getPresentationFrameClass(frame.kind),
        kind: frame.kind,
        trace_id: frame.trace_id,
      });
      ws.send(JSON.stringify(frame));
    }
  }

  private _sendRuntimeReadiness(ws: WebSocket, catalog: RuntimeReadinessCatalog): void {
    this._sendFrame(ws, {
      kind: 'runtime_readiness',
      timestamp: Date.now(),
      runtime_readiness: catalog,
    });
  }

  /** 将本体音频能力快照发送给 Control Center。 */
  public broadcastAudioStatus(status: AudioStatusPayload = AudioService.instance.getCachedStatus()): void {
    this.broadcastFrame({
      kind: 'audio_status',
      timestamp: Date.now(),
      audio_status: status,
    });
  }

  private async _sendAudioStatus(ws: WebSocket): Promise<void> {
    this._sendFrame(ws, {
      kind: 'audio_status',
      timestamp: Date.now(),
      audio_status: AudioService.instance.getCachedStatus(),
    });
  }

  private _handleMessage(data: any, ws: WebSocket) {
    // 阶段 8.4：上行帧只接受 PresentationUpstreamFrame.kind。
    const kind: string = (typeof data.kind === 'string' && data.kind) || '';
    if (kind !== 'avatar_presentation') {
      logger.debug('Received UI request', { kind });
    }

    if (kind === 'heartbeat' || kind === 'ping') {
      // 心跳无副作用,无需回 pong(8.3 简化;Electron 端不依赖 pong)。
      return;
    } else if (kind === 'host_hello') {
      // 阶段 8.3:握手帧。当前仅日志记录;8.7+ AvatarHostRegistry 用 capabilities 路由。
      const sh = data.host_hello ?? {};
      logger.info('Avatar hello', {
        host_kind: sh.host_kind,
        host_id: sh.host_id,
        host_version: sh.host_version,
      });
      return;
    } else if (kind === 'chat_input') {
      const text: string = (data.chat_input?.text as string) ?? '';
      const traceId = (typeof data.trace_id === 'string' && data.trace_id)
        || `ui_${Date.now()}`;
      if (!this._configApplicationService?.hasUsableModelRoute()) {
        this._conversationHistoryService?.recordSubmittedUserMessage(text, traceId);
        const notice = {
          code: 'llm_unconfigured',
          level: 'warning',
          title: '尚未配置可用模型',
          message: '控制面可以正常使用，但当前默认对话路由没有可用模型。请前往设置中心添加 Provider、写入 API Key 并选择默认模型。',
          action_route: 'settings',
          action_label: '打开设置中心',
        } as const;
        this._conversationHistoryService?.recordNotice(traceId, notice);
        this._sendFrame(ws, {
          kind: 'conversation_notice',
          trace_id: traceId,
          timestamp: Date.now(),
          conversation_notice: notice,
        });
        return;
      }
      this._conversationHistoryService?.recordSubmittedUserMessage(text, traceId);
      this._injectDesktopText(text, traceId);
    } else if (kind === 'audio_input') {
      const traceId = (typeof data.trace_id === 'string' && data.trace_id)
        || `ui_audio_${Date.now()}`;
      void this._handleAudioInput(data.audio_input, traceId);
    } else if (kind === 'avatar_presentation') {
      const presentation = this._normalizeAvatarPresentation(data.avatar_presentation);
      if (!presentation) {
        logger.warn('忽略无效的形象呈现请求');
        return;
      }
      AvatarController.instance.updatePresentation(presentation);
      const projectionFrame: PresentationDownstreamFrame = {
        kind: 'character_presentation_projection',
        trace_id: typeof data.trace_id === 'string' ? data.trace_id : undefined,
        timestamp: Date.now(),
        character_presentation_projection: AvatarController.instance.getCharacterPresentationProjection(),
      };
      this.broadcastFrame(projectionFrame);
      AvatarController.instance.broadcastFrame(projectionFrame);
    } else if (kind === 'avatar_intent') {
      const intent = this._normalizeAvatarIntent(data.avatar_intent);
      if (!intent) {
        logger.warn('忽略无效的形象动作请求');
        return;
      }
      AvatarController.instance.broadcastFrame({
        kind: 'avatar_intent',
        trace_id: typeof data.trace_id === 'string' ? data.trace_id : undefined,
        timestamp: Date.now(),
        avatar_intent: {
          action_id: intent.action_id,
          operation: intent.operation,
          source: 'user',
          priority: intent.priority,
        },
      });
    } else if (kind === 'core_skill_action_response' || kind === 'core_skill_confirmation_response') {
      this._handleCoreSkillResponse(data);
    } else if (kind === 'config_snapshot_request') {
      void this._handleConfigSnapshotRequest(data.config_snapshot_request, ws);
    } else if (kind === 'conversation_history_request') {
      void this._handleConversationHistoryRequest(data.conversation_history_request, ws);
    } else if (kind === 'config_update_request') {
      void this._handleConfigUpdateRequest(data.config_update_request, ws);
    } else if (kind === 'config_test_request') {
      void this._handleConfigTestRequest(data.config_test_request, ws);
    } else if (kind === 'extension_lifecycle_request') {
      void this._handleExtensionLifecycleRequest(data, ws);
    } else if (kind === 'extension_install_prepare') {
      void this._handleExtensionInstallPrepare(data.extension_install_prepare, ws);
    } else if (kind === 'extension_install_commit') {
      void this._handleExtensionInstallCommit(data.extension_install_commit, ws);
    } else if (kind === 'extension_install_cancel') {
      void this._handleExtensionInstallCancel(data.extension_install_cancel, ws);
    } else if (kind === 'extension_uninstall_request') {
      void this._handleExtensionUninstall(data.extension_uninstall_request, ws);
    } else if (kind === 'extension_command_request') {
      void this._handleExtensionCommandRequest(data, ws);
    } else if (kind === 'extension_runtime_projection_request') {
      this._handleExtensionRuntimeProjectionRequest(data.extension_runtime_projection_request, ws);
    } else if (kind === 'skill_catalog_request') {
      this._handleSkillCatalogRequest(data, ws);
    } else if (kind === 'shutdown_request') {
      const request = data.shutdown_request;
      if (request?.requested_by !== 'control-surface') {
        logger.warn('拒绝未知来源的全局停机请求', {
          requested_by: request?.requested_by,
        });
        return;
      }

      const reason = typeof request.reason === 'string' && request.reason.trim()
        ? request.reason.trim()
        : '用户从桌面壳退出 Glimmer Cradle';
      logger.info('产品控制表面请求全局停机', { reason });
      void this._requestApplicationShutdown?.(reason);
    }
  }

  private async _handleConfigSnapshotRequest(raw: unknown, ws: WebSocket): Promise<void> {
    const request = raw as ConfigurationSnapshotRequest | undefined;
    const requestId = request?.request_id?.trim() || `config-snapshot-${Date.now()}`;
    if (!this._configApplicationService) {
      this._sendFrame(ws, {
        kind: 'configuration_snapshot_result',
        timestamp: Date.now(),
        configuration_snapshot_result: {
          request_id: requestId,
          status: 'error',
          message: '配置服务尚未就绪',
        },
      });
      return;
    }
    try {
      const snapshot = await this._configApplicationService.getSnapshot();
      this._sendFrame(ws, {
        kind: 'configuration_snapshot_result',
        timestamp: Date.now(),
        configuration_snapshot_result: {
          request_id: requestId,
          status: 'success',
          snapshot,
        },
      });
    } catch (error) {
      this._sendFrame(ws, {
        kind: 'configuration_snapshot_result',
        timestamp: Date.now(),
        configuration_snapshot_result: {
          request_id: requestId,
          status: 'error',
          message: errorMessage(error),
        },
      });
    }
  }

  private async _handleConversationHistoryRequest(raw: unknown, ws: WebSocket): Promise<void> {
    const request = raw as ConversationHistoryRequest | undefined;
    const requestId = request?.request_id?.trim()
      ? request.request_id.trim()
      : `conversation-history-${Date.now()}`;
    if (!this._conversationHistoryService) {
      this._sendFrame(ws, {
        kind: 'conversation_history_result',
        timestamp: Date.now(),
        conversation_history_result: {
          request_id: requestId,
          status: 'error',
          items: [],
          has_more: false,
          message: 'Conversation 历史服务尚未就绪',
        },
      });
      return;
    }

    try {
      const result = await this._conversationHistoryService.readHistory({
        request_id: requestId,
        conversation_id: request?.conversation_id,
        scene_id: request?.scene_id,
        thread_id: request?.thread_id,
        actor_id: request?.actor_id,
        source_provider_id: request?.source_provider_id,
        cursor: request?.cursor,
        limit: request?.limit ?? 50,
      });
      this._sendFrame(ws, {
        kind: 'conversation_history_result',
        timestamp: Date.now(),
        conversation_history_result: result,
      });
    } catch (error) {
      this._sendFrame(ws, {
        kind: 'conversation_history_result',
        timestamp: Date.now(),
        conversation_history_result: {
          request_id: requestId,
          status: 'error',
          items: [],
          has_more: false,
          message: errorMessage(error),
        },
      });
    }
  }

  private async _handleConfigUpdateRequest(raw: unknown, ws: WebSocket): Promise<void> {
    const request = raw as ConfigurationUpdateRequest | undefined;
    const requestId = request?.request_id?.trim() || `config-update-${Date.now()}`;
    if (!request || !this._configApplicationService) {
      this._sendFrame(ws, {
        kind: 'configuration_update_result',
        timestamp: Date.now(),
        configuration_update_result: {
          request_id: requestId,
          status: 'error',
          apply_state: 'unchanged',
          change_summary: [],
          message: this._configApplicationService ? '无效的配置更新请求' : '配置服务尚未就绪',
        },
      });
      return;
    }
    try {
      const result = request.dry_run
        ? await this._configApplicationService.previewUpdate(request)
        : await this._configApplicationService.applyUpdate(request);
      this._sendFrame(ws, {
        kind: 'configuration_update_result',
        timestamp: Date.now(),
        configuration_update_result: result,
      });
    } catch (error) {
      this._sendFrame(ws, {
        kind: 'configuration_update_result',
        timestamp: Date.now(),
        configuration_update_result: {
          request_id: requestId,
          status: 'error',
          apply_state: 'unchanged',
          change_summary: [],
          message: errorMessage(error),
        },
      });
    }
  }

  private async _handleConfigTestRequest(raw: unknown, ws: WebSocket): Promise<void> {
    const request = raw as ConfigurationTestRequest | undefined;
    const requestId = request?.request_id?.trim() || `config-test-${Date.now()}`;
    if (!request || !this._configApplicationService) {
      this._sendFrame(ws, {
        kind: 'configuration_test_result',
        timestamp: Date.now(),
        configuration_test_result: {
          request_id: requestId,
          status: 'error',
          message: this._configApplicationService ? '无效的 Provider 测试请求' : '配置服务尚未就绪',
          discovered_models: [],
        },
      });
      return;
    }
    const result = await this._configApplicationService.testProvider(request);
    this._sendFrame(ws, {
      kind: 'configuration_test_result',
      timestamp: Date.now(),
      configuration_test_result: result,
    });
  }

  private async _handleExtensionInstallPrepare(raw: unknown, ws: WebSocket): Promise<void> {
    const request = raw as ExtensionInstallPrepareRequest | undefined;
    const requestId = request?.request_id?.trim() || `extension-install-prepare-${Date.now()}`;
    if (!request?.source || !this._extensionLifecycleController) {
      this._sendFrame(ws, {
        kind: 'extension_install_preview',
        timestamp: Date.now(),
        extension_install_preview: {
          request_id: requestId,
          status: 'error',
          message: !request?.source ? '无效的扩展安装来源' : '扩展管理器尚未就绪',
        },
      });
      return;
    }
    try {
      const preview = await this._extensionLifecycleController.prepareInstall(request.source);
      this._sendFrame(ws, {
        kind: 'extension_install_preview',
        timestamp: Date.now(),
        extension_install_preview: { request_id: requestId, status: 'ready', ...preview },
      });
    } catch (error) {
      this._sendFrame(ws, {
        kind: 'extension_install_preview',
        timestamp: Date.now(),
        extension_install_preview: {
          request_id: requestId,
          status: 'error',
          message: errorMessage(error),
        },
      });
    }
  }

  private async _handleExtensionInstallCommit(raw: unknown, ws: WebSocket): Promise<void> {
    const request = raw as ExtensionInstallCommitRequest | undefined;
    const requestId = request?.request_id?.trim() || `extension-install-commit-${Date.now()}`;
    if (!request?.transaction_id || !Array.isArray(request.approved_permissions) || !this._extensionLifecycleController) {
      this._sendFrame(ws, {
        kind: 'extension_install_result',
        timestamp: Date.now(),
        extension_install_result: {
          request_id: requestId,
          status: 'error',
          message: this._extensionLifecycleController ? '无效的扩展安装提交' : '扩展管理器尚未就绪',
        },
      });
      return;
    }
    try {
      const result = await this._extensionLifecycleController.commitInstall(
        request.transaction_id,
        request.approved_permissions,
      );
      this._sendFrame(ws, {
        kind: 'extension_install_result',
        timestamp: Date.now(),
        extension_install_result: { request_id: requestId, status: 'success', ...result },
      });
    } catch (error) {
      this._sendFrame(ws, {
        kind: 'extension_install_result',
        timestamp: Date.now(),
        extension_install_result: { request_id: requestId, status: 'error', message: errorMessage(error) },
      });
    }
  }

  private async _handleExtensionInstallCancel(raw: unknown, ws: WebSocket): Promise<void> {
    const request = raw as { request_id?: string; transaction_id?: string } | undefined;
    const requestId = request?.request_id?.trim() || `extension-install-cancel-${Date.now()}`;
    if (request?.transaction_id && this._extensionLifecycleController) {
      await this._extensionLifecycleController.cancelInstall(request.transaction_id).catch(() => undefined);
    }
    this._sendFrame(ws, {
      kind: 'extension_install_result',
      timestamp: Date.now(),
      extension_install_result: { request_id: requestId, status: 'cancelled' },
    });
  }

  private async _handleExtensionUninstall(raw: unknown, ws: WebSocket): Promise<void> {
    const request = raw as ExtensionUninstallRequest | undefined;
    const requestId = request?.request_id?.trim() || `extension-uninstall-${Date.now()}`;
    const extensionId = request?.extension_id?.trim() || '';
    const version = request?.version?.trim() || '';
    if (!EXTENSION_ID_PATTERN.test(extensionId) || !version || !this._extensionLifecycleController) {
      this._sendFrame(ws, {
        kind: 'extension_uninstall_result',
        timestamp: Date.now(),
        extension_uninstall_result: {
          request_id: requestId,
          extension_id: extensionId,
          version,
          status: 'error',
          message: this._extensionLifecycleController ? '无效的扩展卸载请求' : '扩展管理器尚未就绪',
        },
      });
      return;
    }
    try {
      await this._extensionLifecycleController.uninstall(extensionId, version);
      this._sendFrame(ws, {
        kind: 'extension_uninstall_result',
        timestamp: Date.now(),
        extension_uninstall_result: { request_id: requestId, extension_id: extensionId, version, status: 'success' },
      });
    } catch (error) {
      this._sendFrame(ws, {
        kind: 'extension_uninstall_result',
        timestamp: Date.now(),
        extension_uninstall_result: {
          request_id: requestId,
          extension_id: extensionId,
          version,
          status: 'error',
          message: errorMessage(error),
        },
      });
    }
  }

  private _handleExtensionRuntimeProjectionRequest(raw: unknown, ws: WebSocket): void {
    const request = raw as ExtensionRuntimeProjectionRequest | undefined;
    const requestId = request?.request_id?.trim()
      ? request.request_id.trim()
      : `extension-runtime-projection-${Date.now()}`;
    const extensionId = request?.extension_id?.trim()
      ? request.extension_id.trim()
      : '';

    if (!this._extensionLifecycleController) {
      this._sendExtensionRuntimeProjectionResponse(ws, requestId, 'error', undefined, undefined, '扩展运行投影尚未就绪');
      return;
    }

    const projection = extensionId
      ? this._extensionLifecycleController.getRuntimeProjection(extensionId)
      : undefined;
    const projections = extensionId
      ? projection ? [projection] : []
      : this._extensionLifecycleController.listRuntimeProjections();
    const installations = this._extensionLifecycleController.listInstallationProjections()
      .filter((item) => !extensionId || item.extension_id === extensionId);
    this._sendExtensionRuntimeProjectionResponse(ws, requestId, 'success', projections, installations);
  }

  private _sendExtensionRuntimeProjectionResponse(
    ws: WebSocket,
    requestId: string,
    status: 'success' | 'error',
    projections: ExtensionRuntimeProjection[] = [],
    installations: ExtensionInstallationProjection[] = [],
    message?: string,
  ): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      kind: 'extension_runtime_projection_result',
      timestamp: Date.now(),
      extension_runtime_projection_result: { request_id: requestId, status, projections, installations, message },
    }));
  }

  private _handleSkillCatalogRequest(data: any, ws: WebSocket): void {
    const request = data.skill_catalog_request as SkillCatalogRequestPayload | undefined;
    const requestId = typeof request?.request_id === 'string' && request.request_id.trim()
      ? request.request_id.trim()
      : `skill-catalog-${Date.now()}`;

    if (!this._skillCatalogAppService) {
      this._sendSkillCatalogResponse(ws, requestId, 'error', undefined, 'Skill Catalog 尚未就绪');
      return;
    }

    this._sendSkillCatalogResponse(
      ws,
      requestId,
      'success',
      this._skillCatalogAppService.getCatalogSnapshot(),
    );
  }

  private _sendSkillCatalogResponse(
    ws: WebSocket,
    requestId: string,
    status: 'success' | 'error',
    snapshot?: SkillCatalogResponsePayload['snapshot'],
    message?: string,
  ): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      kind: 'skill_catalog_response',
      timestamp: Date.now(),
      skill_catalog_response: {
        request_id: requestId,
        status,
        snapshot,
        message,
      } satisfies SkillCatalogResponsePayload,
    }));
  }

  private _handleCoreSkillResponse(data: any): void {
    const requestId = typeof data.request_id === 'string' ? data.request_id : '';
    const pending = this._pendingSurfaceRequests.get(requestId);
    if (!pending) return;
    this._pendingSurfaceRequests.delete(requestId);
    clearTimeout(pending.timer);

    const status = data.status === 'success' ? 'success' : 'error';
    if (status === 'success') {
      pending.resolve(data.result);
      return;
    }

    pending.reject(new Error(typeof data.message === 'string' ? data.message : 'Desktop Skill 执行失败'));
  }

  private async _handleExtensionCommandRequest(data: any, ws: WebSocket): Promise<void> {
    const request = data.extension_command_request as ExtensionCommandRequest | undefined;
    const requestId = request?.request_id?.trim()
      ? request.request_id.trim()
      : `extension-command-${Date.now()}`;
    const commandId = typeof request?.command_id === 'string' ? request.command_id.trim() : '';
    const args = Array.isArray(request?.args) ? request.args : [];

    if (!/^[a-z0-9][a-z0-9_-]*[.:][a-zA-Z0-9_.:-]+$/.test(commandId)) {
      this._sendExtensionCommandResponse(ws, requestId, commandId, 'error', undefined, '无效的扩展命令请求');
      return;
    }

    if (!this._extensionLifecycleController) {
      this._sendExtensionCommandResponse(ws, requestId, commandId, 'error', undefined, '扩展管理器尚未就绪');
      return;
    }

    try {
      const result = await this._extensionLifecycleController.executeCommand(commandId, ...args);
      this._sendExtensionCommandResponse(ws, requestId, commandId, 'success', result);
    } catch (error) {
      this._sendExtensionCommandResponse(
        ws,
        requestId,
        commandId,
        'error',
        undefined,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private _sendExtensionCommandResponse(
    ws: WebSocket,
    requestId: string,
    commandId: string,
    status: 'success' | 'error',
    result?: unknown,
    message?: string,
  ): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      kind: 'extension_command_result',
      timestamp: Date.now(),
      extension_command_result: {
        request_id: requestId,
        command_id: commandId,
        status,
        result,
        message,
      },
    }));
  }

  private async _handleExtensionLifecycleRequest(data: any, ws: WebSocket): Promise<void> {
    const request = data.extension_lifecycle_request as ExtensionLifecycleRequest | undefined;
    const requestId = request?.request_id?.trim()
      ? request.request_id.trim()
      : `extension-lifecycle-${Date.now()}`;
    const extensionId = typeof request?.extension_id === 'string' ? request.extension_id.trim() : '';
    const version = typeof request?.version === 'string' ? request.version.trim() : '';
    const operation = request?.operation;

    if (!EXTENSION_ID_PATTERN.test(extensionId) || (operation !== 'start' && operation !== 'stop')) {
      this._sendExtensionLifecycleResponse(ws, requestId, extensionId, version, operation, 'error', '无效的扩展生命周期请求');
      return;
    }

    if (!this._extensionLifecycleController) {
      this._sendExtensionLifecycleResponse(ws, requestId, extensionId, version, operation, 'error', '扩展管理器尚未就绪');
      return;
    }

    try {
      if (operation === 'start') {
        await this._extensionLifecycleController.activateExtension(extensionId, version || undefined);
      } else {
        await this._extensionLifecycleController.deactivateExtension(extensionId);
      }
      const selectedVersion = operation === 'start'
        ? this._extensionLifecycleController.getRuntimeProjection(extensionId)?.version ?? version
        : version;
      this._sendExtensionLifecycleResponse(ws, requestId, extensionId, selectedVersion, operation, 'success');
    } catch (error) {
      this._sendExtensionLifecycleResponse(
        ws,
        requestId,
        extensionId,
        version,
        operation,
        'error',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private _sendExtensionLifecycleResponse(
    ws: WebSocket,
    requestId: string,
    extensionId: string,
    version: string,
    operation: unknown,
    status: 'success' | 'error',
    message?: string,
  ): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      kind: 'extension_lifecycle_result',
      timestamp: Date.now(),
      extension_lifecycle_result: {
        request_id: requestId,
        extension_id: extensionId,
        version: version || undefined,
        operation,
        status,
        message,
      },
    }));
  }

  /** 过滤桌面端请求，避免把 UI 临时字段直接泄漏给 Avatar。 */
  private _normalizeAvatarPresentation(raw: unknown): NonNullable<PresentationDownstreamFrame['presentation']> | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const value = raw as Record<string, unknown>;
    const placementId = typeof value.placement_id === 'string' ? value.placement_id.trim() : '';
    const scale = typeof value.display_scale === 'number' ? value.display_scale : Number(value.display_scale);
    const resetPlacement = value.reset_placement === true;

    if (!placementId && !Number.isFinite(scale) && !resetPlacement) {
      return null;
    }

    return {
      placement_id: placementId || undefined,
      display_scale: Number.isFinite(scale) ? Math.max(0.5, Math.min(2.5, scale)) : undefined,
      reset_placement: resetPlacement || undefined,
    };
  }

  /** 只接受稳定动作语义；具体 expression、motion 与参数组合只在 Avatar 资产映射内解析。 */
  private _normalizeAvatarIntent(raw: unknown): {
    action_id: string;
    operation: 'trigger' | 'activate' | 'deactivate';
    priority?: number;
  } | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const value = raw as Record<string, unknown>;
    const actionId = typeof value.action_id === 'string' ? value.action_id.trim() : '';
    const operation = value.operation;
    if (!actionId || (operation !== 'trigger' && operation !== 'activate' && operation !== 'deactivate')) {
      return null;
    }

    const priority = typeof value.priority === 'number' && Number.isFinite(value.priority)
      ? Math.max(0, Math.min(100, Math.floor(value.priority)))
      : undefined;
    return {
      action_id: actionId,
      operation,
      priority,
    };
  }

  private async _handleAudioInput(payload: any, traceId: string): Promise<void> {
    const audioId = typeof payload?.audio_id === 'string' && payload.audio_id.trim()
      ? payload.audio_id.trim()
      : `audio-${traceId}`;
    if (!AudioService.instance.isLaneEnabled('asr')) {
      this._broadcastAudioTranscript(traceId, audioId, 'error', undefined, 'ASR 已关闭');
      return;
    }

    const audioData = typeof payload?.audio_data === 'string' ? payload.audio_data : '';
    const mimeType = typeof payload?.mime_type === 'string' ? payload.mime_type : 'audio/wav';

    if (!audioData) {
      this._broadcastAudioTranscript(traceId, audioId, 'error', undefined, '录音数据为空');
      return;
    }

    try {
      const asrDir = path.join(resolveWorkDir(), 'audio', 'asr');
      await mkdir(asrDir, { recursive: true });
      const extension = this._audioExtensionFromMime(mimeType);
      const audioPath = path.join(asrDir, `${this._safeFileToken(audioId)}.${extension}`);
      await writeFile(audioPath, Buffer.from(audioData, 'base64'));

      const result = await AudioService.instance.recognizeSpeech({ audio_path: audioPath, trace_id: traceId });
      if (result.status !== 'success' || !result.text?.trim()) {
        this._broadcastAudioTranscript(
          traceId,
          audioId,
          'error',
          undefined,
          result.message ?? 'ASR 未识别到文本',
        );
        return;
      }

      const text = result.text.trim();
      this._broadcastAudioTranscript(traceId, audioId, 'success', text);
      this._injectDesktopText(text, traceId);
    } catch (error) {
      this._broadcastAudioTranscript(
        traceId,
        audioId,
        'error',
        undefined,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private _broadcastAudioTranscript(
    traceId: string,
    audioId: string,
    status: 'success' | 'error',
    text?: string,
    message?: string,
  ): void {
    const transcript: NonNullable<PresentationDownstreamFrame['audio_transcript']> = {
      audio_id: audioId,
      status,
    };
    if (text) transcript.text = text;
    if (message) transcript.message = message;

    this.broadcastFrame({
      kind: 'audio_transcript',
      trace_id: traceId,
      timestamp: Date.now(),
      audio_transcript: transcript,
    });
  }

  private _injectDesktopText(text: string, traceId: string): void {
    const normalized = text.trim();
    if (!normalized) return;
    const resolved = this._perceptionAppService?.getConversationDirectory().resolve({
      provider_id: 'desktop-ui',
      provider_account_id: 'local',
      space_kind: 'personal',
      external_space_key: 'primary',
      actor_endpoint_key: 'local-user',
      actor_display_name: '本地用户',
      continuity_key: 'local-user',
      visibility: 'private',
    }, traceId);
    if (!resolved) return;

    const simEvent: PerceptionEvent = {
      id: traceId,
      trace_id: traceId,
      timestamp: Date.now(),
      source: resolved.source_key,
      sensoryType: 'text',
      familiarity: 10,
      address_mode: 'direct',
      response_policy: 'reply_allowed',
      conversation: resolved.context,
      origin: {
        provider_kind: 'user',
        provider_id: 'desktop-ui',
        source_event_id: traceId,
        schema_ref: 'glimmer://desktop/text-input/v1',
        trust_tier: 'user_asserted',
        privacy_class: 'private',
        cognitive_effect: 'observation',
      },
      retention_ceiling: 'memory_candidate',
      content: {
        text: normalized,
        modality: ['text'],
        actor_id: resolved.actor_id,
        actor_name: resolved.actor_name,
      },
    };

    if (this._perceptionAppService) {
      this._perceptionAppService.processIngress(simEvent).catch((err: any) => {
        logger.error('Failed to process UI input', { err });
      });
    } else {
      logger.warn('PerceptionAppService not initialized');
    }
  }

  private _audioExtensionFromMime(mimeType: string): string {
    if (mimeType.includes('wav')) return 'wav';
    if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
    if (mimeType.includes('webm')) return 'webm';
    return 'audio';
  }

  private _safeFileToken(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96) || `audio_${Date.now()}`;
  }

  public async stop(): Promise<void> {
    // 阶段 8.2:setInterval 已删,无需 clearInterval。
    if (this._wss) {
      const server = this._wss;
      const shutdownFrame: PresentationDownstreamFrame = {
        kind: 'shutdown',
        timestamp: Date.now(),
      };
      await Promise.all([...server.clients].map((client) => closeSurfaceClient(client, shutdownFrame)));
      await closeWebSocketServer(server);
      this._wss = null;
    }
    await EndpointRegistry.instance.revoke('control-surface');
    this._clients.clear();
    this._disposeRuntimeReadinessSubscription?.();
    this._disposeRuntimeReadinessSubscription = null;
    for (const [requestId, pending] of this._pendingSurfaceRequests) {
      this._pendingSurfaceRequests.delete(requestId);
      clearTimeout(pending.timer);
      pending.reject(new Error('ControlSurfaceGateway 已停止'));
    }
    this._requestApplicationShutdown = null;
    this._lastAvatarActionState = null;
    this._conversationHistoryService = null;
    this._initialized = false;
    logger.info('ControlSurfaceGateway stopped');
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function closeSurfaceClient(client: WebSocket, frame: PresentationDownstreamFrame): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.off('close', finish);
      resolve();
    };
    const timer = setTimeout(() => {
      client.terminate();
      finish();
    }, 500);
    timer.unref();
    client.once('close', finish);
    if (client.readyState !== WebSocket.OPEN) {
      client.terminate();
      finish();
      return;
    }
    client.send(JSON.stringify(frame), (error) => {
      if (error) client.terminate();
      else client.close(1001, 'kernel_shutdown');
    });
  });
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
