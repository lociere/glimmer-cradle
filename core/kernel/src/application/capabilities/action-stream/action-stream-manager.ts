import { ActionStreamCancelledEvent, ActionStreamCompletedEvent, ActionStreamStartedEvent } from '../../../domain/events';
import type { KernelConfiguration } from '../../../ports/configuration.port';
import type { KernelEventBusPort } from '../../../ports/event-bus.port';
import type { KernelLoggerPort, KernelObservabilityPort } from '../../../ports/observability.port';

type StreamState = {
  sceneId: string;
  streamId: string;
  sourceType: string;
};

export class ActionStreamManager {
  private _initialized: boolean = false;
  private _enabled: boolean = true;
  private _channel: "live2d" = "live2d";
  private readonly _streams: Map<string, StreamState> = new Map();

  private readonly logger: KernelLoggerPort;

  public constructor(
    private readonly config: KernelConfiguration['character']['inference']['action_stream'],
    private readonly eventBus: KernelEventBusPort,
    private readonly observability: KernelObservabilityPort,
  ) {
    this.logger = observability.logger('action-stream-manager');
  }

  public init(): void {
    const streamConfig = this.config;
    this._enabled = streamConfig.enabled;
    this._channel = streamConfig.channel;
    this._initialized = true;

    this.logger.info("动作流管理器初始化完成", {
      enabled: this._enabled,
      channel: this._channel,
    });
  }

  public async startThinkingStream(sceneId: string, streamId: string, sourceType: string): Promise<void> {
    if (!this.ensureReady()) {
      return;
    }

    const existing = this._streams.get(streamId);
    if (existing) {
      this.clearStream(streamId);
    }

    const state: StreamState = { sceneId, streamId, sourceType };
    this._streams.set(streamId, state);

    await this.eventBus.publish(
      new ActionStreamStartedEvent(
        {
          scene_id: sceneId,
          stream_id: streamId,
          channel: this._channel,
          source_type: sourceType,
          stage: "thinking",
        },
        this.observability.createTraceContext(streamId),
      )
    );
  }

  public async completeStream(sceneId: string, streamId: string, finalEmotion: string, replyLength: number): Promise<void> {
    if (!this.ensureReady()) {
      return;
    }

    this.clearStream(streamId);

    await this.eventBus.publish(
      new ActionStreamCompletedEvent(
        {
          scene_id: sceneId,
          stream_id: streamId,
          channel: this._channel,
          final_emotion: finalEmotion,
          reply_length: replyLength,
        },
        this.observability.createTraceContext(streamId),
      )
    );
  }

  public async cancelStream(sceneId: string, streamId: string, reason: string): Promise<void> {
    if (!this.ensureReady()) {
      return;
    }

    this.clearStream(streamId);

    await this.eventBus.publish(
      new ActionStreamCancelledEvent(
        {
          scene_id: sceneId,
          stream_id: streamId,
          channel: this._channel,
          reason,
        },
        this.observability.createTraceContext(streamId),
      )
    );
  }

  public stop(): void {
    this._streams.clear();
  }

  private ensureReady(): boolean {
    if (!this._initialized) {
      this.init();
    }
    return this._enabled;
  }

  private clearStream(streamId: string): void {
    this._streams.delete(streamId);
  }
}
