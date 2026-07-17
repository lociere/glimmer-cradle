/**
 * IngressGateManager — 入站防护管理器
 *
 * Foundation 层共享基础设施原语，为整个系统提供输入防护。
 * 适用于所有外部输入源（聊天消息、语音识别、视觉感知、传感器数据等）。
 *
 * 三重防护机制：
 *   1. 系统就绪守卫 — 系统未就绪时拒绝一切输入
 *   2. 来源速率限制 — 滑动窗口限制单来源请求频率
 *   3. 全局熔断器   — 连续失败达阈值后临时拒绝所有输入
 *
 * 设计原则：
 *   - 与内容过滤 / 注意力管理完全无关
 *   - 透明接入：由 PerceptionAppService 自动调用，插件无需感知
 *   - 全局配置：参数来自 configs/system/kernel.yaml ingress 节
 */
import type { IngressGateConfig } from '@glimmer-cradle/protocol';
import { getLogger } from '../logger/logger';

const logger = getLogger('ingress-gate');

/** 防护拒绝原因 */
export type IngressRejectionType =
  | 'not_ready'
  | 'rate_limited'
  | 'circuit_open'
  | 'overloaded';

/** 防护评估结果 */
export interface IngressGateResult {
  admitted: boolean;
  rejection?: {
    type: IngressRejectionType;
    retryAfterMs?: number;
  };
}

export class IngressGateManager {
  private static _instance: IngressGateManager | null = null;

  // ── 配置 ────────────────────────────────────────────────
  private _config: IngressGateConfig = {
    rate_limit_per_source: 30,
    rate_limit_window_ms: 60_000,
    max_concurrent_requests: 10,
    circuit_breaker_threshold: 5,
    circuit_breaker_recovery_ms: 30_000,
  };

  // ── 就绪守卫 ────────────────────────────────────────────
  private _systemReady = false;

  // ── 速率限制（来源 → 时间戳数组） ───────────────────────
  private _sourceWindows: Map<string, number[]> = new Map();

  // ── 全局并发 ────────────────────────────────────────────
  private _inFlightCount = 0;

  // ── 熔断器 ──────────────────────────────────────────────
  private _consecutiveFailures = 0;
  private _circuitOpenUntil = 0;

  // ── 定期清理 ────────────────────────────────────────────
  private _cleanupTimer: ReturnType<typeof setInterval> | null = null;

  public static get instance(): IngressGateManager {
    if (!IngressGateManager._instance) {
      IngressGateManager._instance = new IngressGateManager();
    }
    return IngressGateManager._instance;
  }

  private constructor() {}

  // ═══════════════════════════════════════════════════════════
  //  生命周期
  // ═══════════════════════════════════════════════════════════

  /** 使用内核配置初始化 */
  public init(config: IngressGateConfig): void {
    this._config = { ...config };
    // 每分钟清理过期的滑动窗口数据
    this._cleanupTimer = setInterval(() => this.pruneExpiredWindows(), 60_000);
    logger.info('入站防护已初始化', {
      rate_limit: `${config.rate_limit_per_source}/${config.rate_limit_window_ms}ms`,
      max_concurrent: config.max_concurrent_requests,
      circuit_breaker: `${config.circuit_breaker_threshold} failures → ${config.circuit_breaker_recovery_ms}ms cooldown`,
    });
  }

  public stop(): void {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this._sourceWindows.clear();
    this._inFlightCount = 0;
    this._consecutiveFailures = 0;
    this._circuitOpenUntil = 0;
    this._systemReady = false;
  }

  // ═══════════════════════════════════════════════════════════
  //  就绪守卫
  // ═══════════════════════════════════════════════════════════

  /** 由 app.ts 在 AI 就绪后调用 */
  public setSystemReady(ready: boolean): void {
    this._systemReady = ready;
    logger.info('系统就绪状态变更', { ready });
  }

  public get isSystemReady(): boolean {
    return this._systemReady;
  }

  // ═══════════════════════════════════════════════════════════
  //  核心评估
  // ═══════════════════════════════════════════════════════════

  /**
   * 评估一条输入是否应被系统接收。
   * 通过时自动递增并发计数和速率窗口。
   * @param sourceId 来源标识（如 napcat:group:123456）
   */
  public admit(sourceId: string): IngressGateResult {
    // 1. 系统就绪
    if (!this._systemReady) {
      return { admitted: false, rejection: { type: 'not_ready' } };
    }

    // 2. 熔断器
    const now = Date.now();
    if (this._circuitOpenUntil > now) {
      return {
        admitted: false,
        rejection: {
          type: 'circuit_open',
          retryAfterMs: this._circuitOpenUntil - now,
        },
      };
    }
    // 半开状态：熔断期过 → 重置计数器
    if (this._circuitOpenUntil > 0) {
      this._circuitOpenUntil = 0;
      this._consecutiveFailures = 0;
    }

    // 3. 全局并发
    if (this._inFlightCount >= this._config.max_concurrent_requests) {
      return { admitted: false, rejection: { type: 'overloaded' } };
    }

    // 4. 来源速率限制
    if (!this.tryConsumeRateToken(sourceId, now)) {
      return {
        admitted: false,
        rejection: {
          type: 'rate_limited',
          retryAfterMs: this._config.rate_limit_window_ms,
        },
      };
    }

    // 放行 → 增加并发计数
    this._inFlightCount++;
    return { admitted: true };
  }

  /**
   * 上报一条请求处理完成。
   * 必须在 admit 返回 admitted=true 后配对调用。
   * @param success 处理是否成功（失败累计推动熔断器）
   */
  public complete(success: boolean): void {
    this._inFlightCount = Math.max(0, this._inFlightCount - 1);

    if (success) {
      this._consecutiveFailures = 0;
    } else {
      this._consecutiveFailures++;
      if (this._consecutiveFailures >= this._config.circuit_breaker_threshold) {
        this._circuitOpenUntil = Date.now() + this._config.circuit_breaker_recovery_ms;
        logger.warn('熔断器已触发', {
          consecutive_failures: this._consecutiveFailures,
          recovery_ms: this._config.circuit_breaker_recovery_ms,
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  内部工具
  // ═══════════════════════════════════════════════════════════

  private tryConsumeRateToken(sourceId: string, now: number): boolean {
    const window = this._sourceWindows.get(sourceId) ?? [];
    const cutoff = now - this._config.rate_limit_window_ms;
    const active = window.filter((t) => t > cutoff);

    if (active.length >= this._config.rate_limit_per_source) {
      this._sourceWindows.set(sourceId, active);
      return false;
    }

    active.push(now);
    this._sourceWindows.set(sourceId, active);
    return true;
  }

  private pruneExpiredWindows(): void {
    const now = Date.now();
    const cutoff = now - this._config.rate_limit_window_ms;
    for (const [sourceId, timestamps] of this._sourceWindows) {
      const active = timestamps.filter((t) => t > cutoff);
      if (active.length === 0) {
        this._sourceWindows.delete(sourceId);
      } else {
        this._sourceWindows.set(sourceId, active);
      }
    }
  }
}
