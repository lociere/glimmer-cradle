/**
 * VisualCommandDispatcher — 视觉指令分发器
 *
 * 将本地 surface 的 ActionStream 事件翻译为 VisualCommand 分发事件。
 *
 * 职责：
 *   1. 监听本地 Desktop/Avatar surface 的 ActionStream 事件
 *   2. 将情绪映射为视觉指令（表情/动作/音频）
 *   3. 通过插件事件总线发布 VisualCommandDispatchEvent
 *   4. Avatar 渲染链路消费并执行
 *
 * 设计原则：
 *   - 此组件是内核 → 渲染表达的唯一出口
 *   - 不直接引用任何具体渲染实现
 *   - 远端平台场景（NapCat/Discord/直播等）不驱动本地身体
 */
import { VisualCommandDispatchEvent, ActionStreamStartedEvent, ActionStreamCompletedEvent, ActionStreamCancelledEvent } from '../../../foundation/event-bus/events';
import type { AvatarConfig, VisualCommand } from '@glimmer-cradle/protocol';
import type { ActionStreamStartPayload, ActionStreamCompletePayload, ActionStreamCancelPayload } from '../../../foundation/event-bus/events';
import { EventBus } from "../../../foundation/event-bus/event-bus";
import { ConfigManager } from "../../../foundation/config/config-manager";
import { getLogger } from "../../../foundation/logger/logger";
import { isLocalAvatarSurfaceScene } from './surface-scene-scope';

const logger = getLogger("visual-command-dispatcher");

export class VisualCommandDispatcher {
  private static _instance: VisualCommandDispatcher | null = null;
  private _initialized = false;
  private _emotionMapping: AvatarConfig['emotion_mapping'] = {
    happy: { expression_id: 'happy', motion_group: 'happy', animator_trigger: 'happy' },
    sad: { expression_id: 'sad', motion_group: 'sad', animator_trigger: 'sad' },
    angry: { expression_id: 'angry', motion_group: 'angry', animator_trigger: 'angry' },
    surprised: { expression_id: 'surprised', motion_group: 'surprised', animator_trigger: 'surprised' },
    neutral: { expression_id: 'neutral', motion_group: 'idle', animator_trigger: 'idle' },
  };

  public static get instance(): VisualCommandDispatcher {
    if (!VisualCommandDispatcher._instance) {
      VisualCommandDispatcher._instance = new VisualCommandDispatcher();
    }
    return VisualCommandDispatcher._instance;
  }

  private constructor() {}

  /**
   * 初始化：订阅 ActionStream 事件。
   */
  public init(): void {
    if (this._initialized) return;

    this._emotionMapping = ConfigManager.instance.getConfig().system.avatar.emotion_mapping;

    EventBus.instance.subscribe("ActionStreamStartedEvent", async (event) => {
      await this._onStreamStarted((event as ActionStreamStartedEvent).payload);
    });

    EventBus.instance.subscribe("ActionStreamCompletedEvent", async (event) => {
      await this._onStreamCompleted((event as ActionStreamCompletedEvent).payload);
    });

    EventBus.instance.subscribe("ActionStreamCancelledEvent", async (event) => {
      await this._onStreamCancelled((event as ActionStreamCancelledEvent).payload);
    });

    this._initialized = true;
    logger.info("视觉指令分发器已初始化");
  }

  /**
   * 主动发送视觉指令（供内核其他模块调用）。
   */
  public async dispatch(command: VisualCommand): Promise<void> {
    await EventBus.instance.publish(new VisualCommandDispatchEvent(command, undefined));
    logger.debug("视觉指令已分发", {
      command_type: command.command_type,
      trace_id: command.trace_id,
    });
  }

  // ── 事件处理 ──────────────────────────────────────────────

  private async _onStreamStarted(payload: ActionStreamStartPayload): Promise<void> {
    if (!isLocalAvatarSurfaceScene(payload.scene_id)) return;

    if (payload.stage === "thinking") {
      await this.dispatch({
        trace_id: payload.stream_id ?? "",
        command_type: "set_expression",
        timestamp: Date.now(),
        expression: {
          expression_id: "thinking",
          blend_time_ms: 200,
          auto_reset: true,
        },
      });
    }
  }

  private async _onStreamCompleted(payload: ActionStreamCompletePayload): Promise<void> {
    if (!isLocalAvatarSurfaceScene(payload.scene_id)) return;

    const traceId = payload.stream_id ?? "";
    const emotion = payload.final_emotion ?? "neutral";
    const mapping = this._emotionMapping[emotion];

    await this.dispatch({
      trace_id: traceId,
      command_type: "set_expression",
      timestamp: Date.now(),
      expression: mapping?.expression_id
        ? {
            expression_id: mapping.expression_id,
            blend_time_ms: 300,
            auto_reset: false,
          }
        : {
            expression_id: emotion,
            blend_time_ms: 300,
            auto_reset: false,
          },
      motion: mapping?.motion_group
        ? {
            motion_id: mapping.animator_trigger ?? emotion,
            motion_group: mapping.motion_group,
          }
        : undefined,
      emotion_state: {
        emotion_type: emotion,
        intensity: 0.8,
      },
    });

    // 2. 延迟后回到待机（由渲染器插件自行决定是否执行）
    // 这里不做延迟，只发 idle 提示
    logger.debug("流完成，情绪表情已分发", {
      trace_id: traceId,
      emotion,
    });
  }

  private async _onStreamCancelled(payload: ActionStreamCancelPayload): Promise<void> {
    if (!isLocalAvatarSurfaceScene(payload.scene_id)) return;

    await this.dispatch({
      trace_id: payload.stream_id ?? "",
      command_type: "idle",
      timestamp: Date.now(),
    });
  }

  public stop(): void {
    this._initialized = false;
    logger.info("视觉指令分发器已停止");
  }
}
