/* Kernel config Adapter 的 schema-derived Document projection；serialized shape 由 contracts/json-schema/config/v1 拥有。 */

import type { ControlSurfaceGatewayConfig } from '../../../ports/application-capabilities.port';

/**
 * 人物呈现出口配置。Surface 只拥有窗口、交互与平台呈现，不拥有 Avatar。
 */
export interface SurfaceConfig {
  control_surface_gateway: ControlSurfaceGatewayConfig;
}
