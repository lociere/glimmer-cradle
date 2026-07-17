/* 自动生成 — 从 SurfaceConfig.schema.json 生成，勿手动修改 */

/**
 * 人物呈现出口配置。Surface 只拥有窗口、交互与平台呈现，不拥有 Avatar。
 */
export interface SurfaceConfig {
  control_surface_gateway: ControlSurfaceGatewayConfig;
}
/**
 * 产品控制表面与 Kernel 之间的回环通信网关配置。
 */
export interface ControlSurfaceGatewayConfig {
  enabled: boolean;
}
