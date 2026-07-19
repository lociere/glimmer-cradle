/* 自动生成 — 从 ConfigurationProviderDraft.schema.json 生成，勿手动修改 */

import type { ConfigurationModelAlias } from './ConfigurationModelAlias';

export interface ConfigurationProviderDraft {
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
   * write-only secret。保存后不回显。
   */
  api_key?: string;
  /**
   * 显式清除当前 provider secret。
   */
  clear_api_key?: boolean;
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
   * 自定义请求头。
   */
  request_headers?: {
    [k: string]: string;
  };
  /**
   * 请求体模板。
   */
  request_body_template?: string;
  /**
   * 响应提取路径。
   */
  response_extract?: string;
  /**
   * Provider 暴露的模型别名列表。
   *
   * @minItems 1
   */
  models: [ConfigurationModelAlias, ...ConfigurationModelAlias[]];
}
