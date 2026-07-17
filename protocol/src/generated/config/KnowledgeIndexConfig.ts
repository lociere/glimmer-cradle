/* 自动生成 — 从 KnowledgeIndexConfig.schema.json 生成，勿手动修改 */

/**
 * 角色 Knowledge Vault 文件索引。索引只引用 knowledge/ 下的资料文件；Kernel 加载后组装为 KnowledgeBaseConfig 投放给 Cognition。
 */
export interface KnowledgeIndexConfig {
  version: string;
  retrieval: KnowledgeIndexRetrievalConfig;
  entries: KnowledgeIndexEntry[];
}
export interface KnowledgeIndexRetrievalConfig {
  mode: 'full_injection' | 'semantic_rag';
  top_k: number;
  min_score: number;
  semantic_weight: number;
}
export interface KnowledgeIndexEntry {
  entry_id: string;
  file: string;
  priority: number;
  enabled: boolean;
}
