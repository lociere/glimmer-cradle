/* Kernel config Adapter 的 schema-derived Document projection；serialized shape 由 contracts/json-schema/config/v1 拥有。 */

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
