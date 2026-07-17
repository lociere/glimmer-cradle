/**
 * 生命时钟管理器
 * 定期探测 Cognition 活性，并发布 Kernel 侧生命时钟事件。
 * 认知节拍和主动性完全由 Cognition Cognitive Activity 管理。
 */
import { ConfigManager } from "../../../foundation/config/config-manager";
import { getLogger } from "../../../foundation/logger/logger";
import { EventBus } from "../../../foundation/event-bus/event-bus";
/**
 * 来源注意力策略 —— 由插件通过 registerSourcePolicies 注入，kernel 内部使用，
 * 不进 YAML 配置故不进 schemas/config/。原为 Zod 推断类型，P.4b 改 ajv 后改为
 * 这里本地声明。
 */
export type SourceAttentionPolicy =
  | "always_focused"
  | "wake_word_focus"
  | "wake_word_focus_with_timeout"
  | "chat_or_wake_focus_with_timeout"
  | "ignore";
import { OrganismAttentionChangedEvent, OrganismAttentionMode, StateSyncEvent } from '../../../foundation/event-bus/events';
import type { CognitiveActivitySnapshot } from '@glimmer-cradle/protocol';
import { IAICapabilityPort } from '../../../foundation/ports';
import { createTraceContext } from '../../../foundation/logger/trace-context';
import { AttentionLeaseChange, AttentionLeaseStore } from "../../attention/attention-lease-store";
import { AttentionTrigger, AttentionTriggerResult } from "./triggers/attention-trigger";
import { WakeKeywordTrigger } from "./triggers/wake-keyword-trigger";

const logger = getLogger("life-clock-manager");

/**
 * 生命时钟管理器
 * 单例模式
 */
export class LifeClockManager {
  private static _instance: LifeClockManager | null = null;
  private _timer: NodeJS.Timeout | null = null;
  private _isRunning: boolean = false;
  private _heartbeatIntervalMs: number = 45000;
  private _focusDurationMs: number = 180000;
  private _focusOnAnyChat: boolean = false;
  private _summonKeywords: string[] = [];
  private _heartbeatEnabled: boolean = false;
  /** 由插件通过 registerSourcePolicies 注入，不从全局配置读取 */
  private _sourceFocusPolicies: Record<string, SourceAttentionPolicy> = {};
  private readonly _attentionLeaseStore: AttentionLeaseStore = AttentionLeaseStore.instance;
  private readonly _triggers: Map<string, AttentionTrigger> = new Map();
  private _aiProxy!: IAICapabilityPort;
  // 当前认知活动快照（来自认知核 state_sync），只驱动心跳间隔。
  private _cognitiveActivity: CognitiveActivitySnapshot | null = null;
  private _stateSyncHandler: ((event: StateSyncEvent) => Promise<void>) | null = null;
  private _lastOrganismAttentionMode: OrganismAttentionMode | null = null;
  private _lastFocusedChannelsKey: string = "";

  /**
   * 获取单例实例
   */
  public static get instance(): LifeClockManager {
    if (!LifeClockManager._instance) {
      LifeClockManager._instance = new LifeClockManager();
    }
    return LifeClockManager._instance;
  }

  private constructor() {}

  /**
   * 初始化生命时钟管理器
   */
  public async init(aiProxy: IAICapabilityPort): Promise<void> {
    this._aiProxy = aiProxy;
    const config = ConfigManager.instance.getConfig();
    const lifeClock = config.character.inference.life_clock;
    this._heartbeatEnabled = lifeClock.heartbeat_enabled;
    this._heartbeatIntervalMs = lifeClock.heartbeat_interval_ms;
    this._focusDurationMs = lifeClock.focus_duration_ms;
    this._focusOnAnyChat = lifeClock.focus_on_any_chat;
    this._summonKeywords = lifeClock.summon_keywords;
    this.ensureDefaultTriggers();

    this._attentionLeaseStore.setChangeHandler((change: AttentionLeaseChange) => {
      this._handleAttentionLeaseChange(change);
      this._updateOrganismAttention();
    });

    // 订阅 state_sync 读取认知活动策略，驱动活性探测间隔。
    this._stateSyncHandler = async (event) => {
      const e = event as StateSyncEvent;
      const state = (e.payload as { state?: { cognitive_activity?: CognitiveActivitySnapshot } } | undefined)?.state;
      const activity = state?.cognitive_activity;
      if (!activity) return;

      const prev = this._cognitiveActivity;
      this._cognitiveActivity = activity;
      if (!prev) {
        logger.info('初始认知活动状态同步', {
          state: activity.state,
          frequency_hint_ms: activity.policy.frequency_hint_ms,
        });
        this.restartLoop();
      } else if (prev.state !== activity.state) {
        logger.info('认知活动状态更新', {
          from: prev.state,
          to: activity.state,
          frequency_hint_ms: activity.policy.frequency_hint_ms,
        });
        this.restartLoop();
      }
    };
    EventBus.instance.subscribe('StateSyncEvent', this._stateSyncHandler);

    logger.info("生命时钟管理器初始化完成", {
      heartbeat_enabled: this._heartbeatEnabled,
      heartbeat_interval_ms: this._heartbeatIntervalMs,
      focus_duration_ms: this._focusDurationMs,
      focus_on_any_chat: this._focusOnAnyChat,
      summon_keywords: this._summonKeywords,
    });
  }

  /**
   * 启动生命时钟
   */
  public start(): void {
    if (this._isRunning) {
      logger.warn("生命时钟已在运行中，跳过重复启动");
      return;
    }

    logger.info("生命时钟启动");
    this._isRunning = true;
    this._lastOrganismAttentionMode = null;
    this._lastFocusedChannelsKey = "";

    if (!this._heartbeatEnabled) {
      logger.info("Cognition 活性探测未启用，生命时钟不启动心跳循环");
      return;
    }

    this.startHeartbeatLoop();
  }

  /**
   * 启动心跳循环
   * Kernel 只探测活性，不触发思维或情绪变化。
   */
  private startHeartbeatLoop(): void {
    if (!this._isRunning) return;
    if (!this._heartbeatEnabled) return;

    const interval = this._cognitiveActivity?.policy.frequency_hint_ms ?? this._heartbeatIntervalMs;

    this._timer = setTimeout(async () => {  
      if (!this._isRunning) return;

      try {
        // 检查 Cognition 认知核是否就绪
        if (!this._aiProxy.isReady) {
          logger.warn("Cognition 认知核未就绪，跳过本次心跳");
          // 未就绪时继续低频探测，认知循环由 Cognition 自己监督。
          this.startHeartbeatLoop();
          return;
        }

        // 仅探测 Cognition 活性；不触发思维或情绪变化。
        await this._aiProxy.sendLifeHeartbeat({});

      } catch (error) {
        logger.error("生命心跳执行异常", { error: (error as Error).message });
      } finally {
        // 继续下一次循环；启停由显式配置和 LifeClock 生命周期控制。
        this.startHeartbeatLoop();
      }
    }, interval);
  }

  /**
   * 消息触发注意力状态变化：支持“呼唤后聚焦”与“任意聊天聚焦”两种策略
   */
  public onUserMessage(content: string, sourceType: string = "unknown"): void {
    // 无论心跳是否启用，焦点状态变更都要生效（影响防抖时间窗口）
    if (!this._isRunning) return;
    const normalized = String(content || "");
    const normalizedSource = String(sourceType || "unknown").toLowerCase();
    const policy = this.resolveSourcePolicy(normalizedSource);
    const trigger = this.evaluateTriggers(normalized, normalizedSource);

    if (policy === "ignore") {
      return;
    }

    if (policy === "always_focused") {
      return;
    }

    if (policy === "wake_word_focus" || policy === "wake_word_focus_with_timeout") {
      return;
    }
  }

  /**
   * 重启心跳循环
   */
  private restartLoop(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._isRunning) {
      this.startHeartbeatLoop();
    }
  }

  /**
   * 获取当前时钟状态
   */
  public get state(): { isRunning: boolean; heartbeatEnabled: boolean } {
    return {
      isRunning: this._isRunning,
      heartbeatEnabled: this._heartbeatEnabled,
    };
  }

  /**
   * 根据各频道聚焦状态计算并发布有机体注意力变化事件
   */
  private _updateOrganismAttention(): void {
    const projection = this._attentionLeaseStore.getProjection('idle');
    const focusedChannels = projection.focused_channel_ids;

    const mode: OrganismAttentionMode =
      projection.mode === 'focused' || projection.mode === 'active'
        ? 'ACTIVE'
        : projection.mode === 'passive'
        ? 'PASSIVE'
        : 'IDLE';
    const focusedChannelsKey = focusedChannels.join('\u0000');
    if (
      this._lastOrganismAttentionMode === mode &&
      this._lastFocusedChannelsKey === focusedChannelsKey
    ) {
      return;
    }
    this._lastOrganismAttentionMode = mode;
    this._lastFocusedChannelsKey = focusedChannelsKey;

    EventBus.instance.publish(
      new OrganismAttentionChangedEvent(
        { mode, focusedChannels },
        createTraceContext()
      )
    );
  }

  /**
   * 停止生命时钟，优雅停机
   */
  public stop(): void {
    if (!this._isRunning) return;
    logger.info("生命时钟停止");
    this._isRunning = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    // 取消订阅事件，避免内存泄漏
    if (this._stateSyncHandler) {
      EventBus.instance.unsubscribe('StateSyncEvent', this._stateSyncHandler);
      this._stateSyncHandler = null;
    }
    this._attentionLeaseStore.clear();
    this._lastOrganismAttentionMode = null;
    this._lastFocusedChannelsKey = "";
  }

  private resolveSourcePolicy(sourceType: string): SourceAttentionPolicy {
    return this._sourceFocusPolicies[sourceType]
      ?? this._sourceFocusPolicies["unknown"]
      ?? "chat_or_wake_focus_with_timeout";
  }

  /**
   * 注册来源类型的注意力策略（由插件在激活时注入）。
   * 重复注册同一 sourceType 时后注册覆盖先注册。
   */
  public registerSourcePolicies(policies: Record<string, SourceAttentionPolicy>): void {
    for (const [sourceType, policy] of Object.entries(policies)) {
      this._sourceFocusPolicies[sourceType] = policy;
    }
    logger.info("来源注意力策略已更新", { policies: this._sourceFocusPolicies });
  }

  public registerTrigger(trigger: AttentionTrigger): void {
    this._triggers.set(trigger.id, trigger);
  }

  public unregisterTrigger(triggerId: string): void {
    this._triggers.delete(triggerId);
  }

  private ensureDefaultTriggers(): void {
    if (!this._triggers.has("wake-keyword-trigger")) {
      this.registerTrigger(new WakeKeywordTrigger());
    }
  }

  private evaluateTriggers(content: string, sourceType: string): AttentionTriggerResult {
    for (const trigger of this._triggers.values()) {
      try {
        const result = trigger.evaluate({
          content,
          sourceType,
          summonKeywords: this._summonKeywords,
          focusOnAnyChat: this._focusOnAnyChat,
        });
        if (result.matched) {
          return result;
        }
      } catch (error) {
        logger.error('注意力触发器执行异常', {
          trigger_id: trigger.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { matched: false };
  }

  private _handleAttentionLeaseChange(change: AttentionLeaseChange): void {
    if (change.type === "expired") {
      logger.debug('频道焦点超时，自动重置', {
        channelId: change.lease.channel_id,
        lease_id: change.lease.lease_id,
        expires_at: change.lease.expires_at,
      });
    }
  }
}
