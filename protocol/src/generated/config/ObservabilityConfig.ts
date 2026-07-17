/* 自动生成 — 从 ObservabilityConfig.schema.json 生成，勿手动修改 */

/**
 * 可观测性配置：日志格式、级别、轮转与模型调用观测采集策略。
 */
export interface ObservabilityConfig {
  /**
   * 控制台输出格式：pretty 供开发阅读；json 供机器解析。
   */
  console_format: 'pretty' | 'json';
  /**
   * 文件输出格式，固定为 json。
   */
  file_format: 'json';
  /**
   * 全局默认日志级别。
   */
  level: 'debug' | 'info' | 'warn' | 'error';
  /**
   * 按模块覆盖日志级别。
   */
  module_levels: {
    [k: string]: 'debug' | 'info' | 'warn' | 'error';
  } | null;
  rotation: LogRotationConfig;
  model_invocations: ModelInvocationCaptureConfig;
  retention: ObservabilityRetentionConfig;
  index: ObservabilityIndexConfig;
  bundles: ObservabilityBundleConfig;
}
/**
 * 日志轮转参数，供 logger.ts / logger.py 共享。
 */
export interface LogRotationConfig {
  /**
   * 主日志单文件大小上限（MB）。
   */
  main_size_mb: number;
  /**
   * 主日志保留文件数。
   */
  main_keep: number;
  /**
   * 错误日志单文件大小上限（MB）。
   */
  error_size_mb: number;
  /**
   * 错误日志保留文件数。
   */
  error_keep: number;
}
/**
 * 模型调用观测配置；summary 为默认模式，full 需显式打开。
 */
export interface ModelInvocationCaptureConfig {
  /**
   * 采集模式：off 不记录；summary 仅摘要；full 落完整 capture。
   */
  capture_mode: 'off' | 'summary' | 'full';
  /**
   * full 模式 capture 的建议保留天数。
   */
  full_retention_days: number;
  /**
   * 是否在记录与 capture 中脱敏 API key、Bearer token 等敏感值。
   */
  redact_secrets: boolean;
}
export interface ObservabilityRetentionConfig {
  events_days: number;
  traces_days: number;
  metrics_days: number;
  audit_days: number;
  model_invocation_days: number;
  application_log_days: number;
  dlq_days: number;
  bundles_days: number;
}
export interface ObservabilityIndexConfig {
  mode: 'sqlite' | 'jsonl_scan';
  db_path: string;
}
export interface ObservabilityBundleConfig {
  export_dir: string;
  process_tail_bytes: number;
  include_model_invocation_captures: boolean;
}
