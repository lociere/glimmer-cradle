/* 自动生成 — 从 LLMConfig.schema.json 生成，勿手动修改 */

/**
 * LLM 提供商配置（主提供商 + 多备选）—— 通过 'provider/alias' 格式字符串引用，provider_key=None 时取根 models 字典第一个值。
 */
export interface LLMConfig {
  /**
   * 主 API 协议类型
   */
  api_type: string;
  /**
   * 主 API Key（优先从 secrets.yaml 注入）
   */
  api_key?: string;
  /**
   * 主 API 端点
   */
  base_url?: string;
  /**
   * 根配置模型字典：alias → 模型 ID；provider_key=None 时取第一个值
   */
  models?: {
    [k: string]: string;
  };
  /**
   * 主采样温度
   */
  temperature?: number;
  /**
   * 多提供商配置映射（key = 提供商名称）
   */
  providers?: {
    [k: string]: LLMProviderConfig;
  };
  /**
   * 自定义 HTTP 方法
   */
  request_method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /**
   * 自定义请求路径
   */
  request_path?: string;
  /**
   * 自定义请求头
   */
  request_headers?: {
    [k: string]: string;
  };
  /**
   * 请求体模板
   */
  request_body_template?: string;
  /**
   * 响应解析路径
   */
  response_extract?: string;
}
/**
 * 单个 LLM 提供商配置（拒绝旧 model 字段等备用键，对应 Zod .strict()）
 */
export interface LLMProviderConfig {
  /**
   * API 协议类型
   */
  api_type: string;
  /**
   * API Key（优先从 secrets.yaml 注入，此处可留空）
   */
  api_key?: string;
  /**
   * API 端点地址
   */
  base_url?: string;
  /**
   * 模型字典：alias → 模型 ID；无 alias 时取第一个值
   */
  models: {
    [k: string]: string;
  };
  /**
   * 采样温度覆盖
   */
  temperature?: number;
  /**
   * 自定义 HTTP 方法
   */
  request_method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /**
   * 自定义请求路径
   */
  request_path?: string;
  /**
   * 自定义请求头
   */
  request_headers?: {
    [k: string]: string;
  };
  /**
   * 请求体模板（支持 {prompt} / {model} / {temperature} 占位符）
   */
  request_body_template?: string;
  /**
   * 响应解析路径（点分隔，例如 choices.0.text）
   */
  response_extract?: string;
}
