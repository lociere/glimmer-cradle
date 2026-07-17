/* 自动生成 — 从 IPCConfig.schema.json 生成，勿手动修改 */

/**
 * IPC 通信层配置（TS ↔ Python）—— ZMQ 绑定 / 超时 / 重试 / 心跳。
 */
export interface IPCConfig {
  /**
   * ZMQ 回环绑定策略；实际端口由操作系统分配并由 EndpointRegistry 发布
   */
  bind_address: 'tcp://127.0.0.1:*';
  /**
   * 单次 IPC 请求超时（ms）
   */
  request_timeout_ms: number;
  /**
   * 请求失败重试次数
   */
  retry_count: number;
  /**
   * 重试间隔（ms）
   */
  retry_interval_ms: number;
  /**
   * Python 层心跳检测间隔（ms）
   */
  heartbeat_interval_ms: number;
}
