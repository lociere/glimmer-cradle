/* 自动生成 — 从 ConfigurationUpdateRequest.schema.json 生成，勿手动修改 */

import type { AudioConfig, ASRConfig, TTSConfig, TTSRouteConfig, CircuitBreakerConfig, TTSCacheConfig, TTSProvidersConfig, DashScopeCosyVoiceConfig } from '../config/AudioConfig';
import type { EmbeddingConfig, EmbeddingRouteConfig, EmbeddingProvidersConfig, DashScopeEmbeddingProviderConfig, LocalEmbeddingProviderConfig } from '../config/EmbeddingConfig';
import type { MemoryConfig, WorkingMemoryConfig, ConversationProjectionConfig, ExperienceLedgerConfig, ConsolidationConfig, RetrievalConfig } from '../config/MemoryConfig';
import type { SkillPlaneConfig, McpServerConfig, UserSkillConfig } from '../config/SkillPlaneConfig';
import type { ConfigurationProviderDraft } from './ConfigurationProviderDraft';

export interface ConfigurationUpdateRequest {
  request_id: string;
  /**
   * 客户端基于的快照修订号。
   */
  revision: string;
  /**
   * 只生成预览，不提交。
   */
  dry_run?: boolean;
  llm: {
    default_route_provider_key?: string;
    default_route_model_alias?: string;
    providers: ConfigurationProviderDraft[];
    removed_provider_keys: string[];
  };
  audio: AudioConfig;
  embedding: EmbeddingConfig;
  memory: MemoryConfig;
  skills: SkillPlaneConfig;
}
