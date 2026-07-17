import { ActionStreamCancelledEvent, ActionStreamCompletedEvent, ActionStreamStartedEvent } from '../../../foundation/event-bus/events';
import { createTraceContext } from '../../../foundation/logger/trace-context';
import { ConfigManager } from "../../../foundation/config/config-manager";
import { EventBus } from "../../../foundation/event-bus/event-bus";
import { getLogger } from "../../../foundation/logger/logger";

const logger = getLogger("action-stream-manager");

type StreamState = {
  sceneId: string;
  streamId: string;
  sourceType: string;
};

export class ActionStreamManager {
  private static _instance: ActionStreamManager | null = null;
  private _initialized: boolean = false;
  private _enabled: boolean = true;
  private _channel: "live2d" = "live2d";
  private readonly _streams: Map<string, StreamState> = new Map();

  public static get instance(): ActionStreamManager {
    if (!ActionStreamManager._instance) {
      ActionStreamManager._instance = new ActionStreamManager();
    }
    return ActionStreamManager._instance;
  }

  private constructor() {}

  public init(): void {
    const config = ConfigManager.instance.getConfig();
    const streamConfig = config.character.inference.action_stream;
    this._enabled = streamConfig.enabled;
    this._channel = streamConfig.channel;
    this._initialized = true;

    logger.info("动作流管理器初始化完成", {
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

    await EventBus.instance.publish(
      new ActionStreamStartedEvent(
        {
          scene_id: sceneId,
          stream_id: streamId,
          channel: this._channel,
          source_type: sourceType,
          stage: "thinking",
        },
        createTraceContext({ trace_id: streamId }),
      )
    );
  }

  public async completeStream(sceneId: string, streamId: string, finalEmotion: string, replyLength: number): Promise<void> {
    if (!this.ensureReady()) {
      return;
    }

    this.clearStream(streamId);

    await EventBus.instance.publish(
      new ActionStreamCompletedEvent(
        {
          scene_id: sceneId,
          stream_id: streamId,
          channel: this._channel,
          final_emotion: finalEmotion,
          reply_length: replyLength,
        },
        createTraceContext({ trace_id: streamId }),
      )
    );
  }

  public async cancelStream(sceneId: string, streamId: string, reason: string): Promise<void> {
    if (!this.ensureReady()) {
      return;
    }

    this.clearStream(streamId);

    await EventBus.instance.publish(
      new ActionStreamCancelledEvent(
        {
          scene_id: sceneId,
          stream_id: streamId,
          channel: this._channel,
          reason,
        },
        createTraceContext({ trace_id: streamId }),
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
