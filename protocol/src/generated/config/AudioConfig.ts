/* 自动生成 — 从 AudioConfig.schema.json 生成，勿手动修改 */

/**
 * 系统音频策略。只拥有路由、供应商执行参数、韧性和缓存，不拥有角色声线身份。
 */
export interface AudioConfig {
  tts: TTSConfig;
  asr: ASRConfig;
}
export interface TTSConfig {
  enabled: boolean;
  route: TTSRouteConfig;
  cache: TTSCacheConfig;
  providers: TTSProvidersConfig;
}
export interface TTSRouteConfig {
  primary: string;
  fallbacks: string[];
  circuit_breaker: CircuitBreakerConfig;
}
export interface CircuitBreakerConfig {
  failure_threshold: number;
  recovery_timeout_ms: number;
}
export interface TTSCacheConfig {
  enabled: boolean;
  max_age_days: number;
}
export interface TTSProvidersConfig {
  'dashscope-cosyvoice': DashScopeCosyVoiceConfig;
}
export interface DashScopeCosyVoiceConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  format: 'wav';
  sample_rate: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
  connect_timeout_ms: number;
  receive_timeout_ms: number;
  max_retries: number;
}
export interface ASRConfig {
  enabled: boolean;
  provider: 'funasr';
  resource_id: string;
}
