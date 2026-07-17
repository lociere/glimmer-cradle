/* 自动生成 — 从 LifecycleConfig.schema.json 生成，勿手动修改 */

/**
 * 模块生命周期管理配置 —— 启停顺序与超时。
 */
export interface LifecycleConfig {
  /**
   * 模块启动总超时（ms）
   */
  start_timeout_ms: number;
  /**
   * 模块停止总超时（ms）
   */
  stop_timeout_ms: number;
  /**
   * 模块启动顺序（按数组顺序依次启动）
   */
  module_start_order: string[];
  /**
   * 模块停止顺序（按数组顺序依次停止）
   */
  module_stop_order: string[];
}
