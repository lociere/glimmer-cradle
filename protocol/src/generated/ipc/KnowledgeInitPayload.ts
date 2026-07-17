/* 自动生成 — 从 KnowledgeInitPayload.schema.json 生成，勿手动修改 */

/**
 * 知识库初始化消息载荷。只负责 Knowledge Vault 预填，不承载角色人格或对话策略。
 */
export interface KnowledgeInitPayload {
  knowledge_base: KnowledgeBaseInitPayload;
}
/**
 * 知识库初始化主载荷。
 */
export interface KnowledgeBaseInitPayload {
  version: string;
  retrieval: IPCKnowledgeRetrievalConfig;
  entries: KernelKnowledgeRecord[];
}
/**
 * 知识检索配置。
 */
export interface IPCKnowledgeRetrievalConfig {
  mode: 'full_injection' | 'semantic_rag';
  top_k: number;
  min_score: number;
  semantic_weight: number;
}
/**
 * 内核注入的知识库记录。只允许 scope=knowledge；角色人格配置不经 KnowledgeInitPayload。
 */
export interface KernelKnowledgeRecord {
  entry_id: string;
  scope: 'knowledge';
  content: string;
  enabled: boolean;
  priority: number;
}
