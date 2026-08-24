/* Kernel config Adapter 的 schema-derived Document projection；serialized shape 由 contracts/json-schema/config/v1 拥有。 */

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
