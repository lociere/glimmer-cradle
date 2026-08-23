/* 自动生成 — 从 CognitionServiceConfig.schema.json 生成，勿手动修改 */

/**
 * Kernel 调用受监督 CognitionService 的期限配置；端点由进程生命周期动态分配。
 */
export interface CognitionServiceConfig {
  /**
   * 单次 CognitionService RPC deadline（ms）
   */
  request_timeout_ms: number;
  /**
   * 受监督 Cognition 进程注册动态端点的期限（ms）
   */
  registration_timeout_ms: number;
}
