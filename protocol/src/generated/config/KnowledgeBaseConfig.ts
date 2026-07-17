/* 自动生成 — 从 KnowledgeBaseConfig.schema.json 生成，勿手动修改 */

/**
 * 知识条目范围。KnowledgeBaseConfig 只允许 knowledge。
 */
export type KnowledgeScope = 'knowledge';

/**
 * 知识库运行时配置（由 KnowledgeIndexConfig 与 Markdown 正文组装）。Knowledge Vault 只保存外部资料、世界事实或可检索知识；角色身份、人设、表达风格、情绪行为和安全边界不允许放入本配置。
 */
export interface KnowledgeBaseConfig {
  /**
   * 知识库 schema 版本号
   */
  version: string;
  retrieval: KnowledgeRetrievalConfig;
  entries: KnowledgeEntry[];
}
/**
 * 知识检索配置（仅用于 scope=knowledge 条目）
 */
export interface KnowledgeRetrievalConfig {
  /**
   * 检索模式：full_injection = 全量注入 / semantic_rag = 向量检索
   */
  mode: 'full_injection' | 'semantic_rag';
  /**
   * 检索返回数量（semantic_rag 模式下生效）
   */
  top_k: number;
  /**
   * 最低相似度阈值
   */
  min_score: number;
  /**
   * 语义向量匹配权重
   */
  semantic_weight: number;
}
/**
 * 单条知识条目
 */
export interface KnowledgeEntry {
  /**
   * 唯一标识
   */
  entry_id: string;
  scope: KnowledgeScope;
  /**
   * 知识内容文本
   */
  content: string;
  /**
   * 检索优先级（1-100，越大越优先）
   */
  priority: number;
  /**
   * 是否启用
   */
  enabled: boolean;
}
