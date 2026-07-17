/* 自动生成 — 从 IngressGateConfig.schema.json 生成，勿手动修改 */

/**
 * 入站防护配置（速率限制 · 熔断 · 就绪守卫）。
 */
export interface IngressGateConfig {
  /**
   * 单来源滑动窗口内最大请求数
   */
  rate_limit_per_source: number;
  /**
   * 滑动窗口时长（ms）
   */
  rate_limit_window_ms: number;
  /**
   * 全局最大并发处理请求数
   */
  max_concurrent_requests: number;
  /**
   * 连续失败几次后触发熔断
   */
  circuit_breaker_threshold: number;
  /**
   * 熔断恢复等待时间（ms）
   */
  circuit_breaker_recovery_ms: number;
}
