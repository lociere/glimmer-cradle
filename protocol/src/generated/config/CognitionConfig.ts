/* 自动生成 — 从 CognitionConfig.schema.json 生成，勿手动修改 */

/**
 * 认知循环配置。CycleController 是感知、认知与行动仲裁的唯一主线。
 */
export interface CognitionConfig {
  /**
   * 工作区容量上限（GlobalWorkspace.capacity）
   */
  workspace_capacity: number;
  /**
   * 无 cognitive activity policy hint 时的默认 tick 间隔（毫秒）
   */
  default_tick_interval_ms: number;
}
