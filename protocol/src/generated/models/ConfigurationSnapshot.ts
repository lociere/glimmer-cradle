/* 自动生成 — 从 ConfigurationSnapshot.schema.json 生成，勿手动修改 */

import type { AudioConfig, ASRConfig, TTSConfig, TTSRouteConfig, CircuitBreakerConfig, TTSCacheConfig, TTSProvidersConfig, DashScopeCosyVoiceConfig } from '../config/AudioConfig';
import type { EmbeddingConfig, EmbeddingRouteConfig, EmbeddingProvidersConfig, DashScopeEmbeddingProviderConfig, LocalEmbeddingProviderConfig } from '../config/EmbeddingConfig';
import type { MemoryConfig, WorkingMemoryConfig, ConversationProjectionConfig, ExperienceLedgerConfig, ConsolidationConfig, RetrievalConfig } from '../config/MemoryConfig';
import type { SkillPlaneConfig, McpServerConfig, UserSkillConfig } from '../config/SkillPlaneConfig';
import type { ConfigurationProviderSnapshot } from './ConfigurationProviderSnapshot';
import type { ConfigurationRouteSnapshot } from './ConfigurationRouteSnapshot';

export interface ConfigurationSnapshot {
  /**
   * 配置快照修订号。
   */
  revision: string;
  llm: {
    /**
     * 当前 Provider 数量。
     */
    provider_count: number;
    /**
     * 当前 LLM Provider 脱敏快照。
     */
    providers: ConfigurationProviderSnapshot[];
    default_route: ConfigurationRouteSnapshot;
  };
  audio: AudioConfig;
  embedding: EmbeddingConfig;
  memory: MemoryConfig;
  skills: SkillPlaneConfig;
  storage: {
    config_root: string;
    data_root: string;
    state_root: string;
  };
  service: {
    cognition_ready: boolean;
    restart_supported: boolean;
  };
}
