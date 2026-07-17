/* 自动生成 — 从 EmbeddingConfig.schema.json 生成，勿手动修改 */

/**
 * 系统向量能力配置。Provider 负责执行，Cognition 只消费稳定向量 Port。
 */
export interface EmbeddingConfig {
  enabled: boolean;
  route: EmbeddingRouteConfig;
  providers: EmbeddingProvidersConfig;
}
export interface EmbeddingRouteConfig {
  provider: 'dashscope-text-embedding' | 'local-sentence-transformers';
}
export interface EmbeddingProvidersConfig {
  'dashscope-text-embedding': DashScopeEmbeddingProviderConfig;
  'local-sentence-transformers': LocalEmbeddingProviderConfig;
}
export interface DashScopeEmbeddingProviderConfig {
  endpoint: string;
  model: string;
  dimensions: 64 | 128 | 256 | 512 | 768 | 1024 | 1536 | 2048;
  request_timeout_ms: number;
  max_retries: number;
}
export interface LocalEmbeddingProviderConfig {
  model_path: string;
  model_id: string;
  auto_download: boolean;
  device: string;
  batch_size: number;
}
