/* 自动生成 — 从 ConfigurationProviderSnapshot.schema.json 生成，勿手动修改 */

import type { ConfigurationModelAlias } from './ConfigurationModelAlias';

export interface ConfigurationProviderSnapshot {
  /**
   * Provider 稳定 key。
   */
  key: string;
  /**
   * Provider API 协议类型。
   */
  api_type: string;
  /**
   * Provider API 根地址。
   */
  base_url?: string;
  /**
   * 是否已配置 secret。
   */
  has_api_key: boolean;
  /**
   * 采样温度覆盖。
   */
  temperature?: number;
  /**
   * 自定义 HTTP 方法。
   */
  request_method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /**
   * 自定义请求路径。
   */
  request_path?: string;
  /**
   * 响应提取路径。
   */
  response_extract?: string;
  /**
   * Provider 已声明的模型别名列表。
   */
  models: ConfigurationModelAlias[];
}
