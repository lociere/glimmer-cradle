/* 自动生成 — 从 PerceptionEvent.schema.json 生成，勿手动修改 */

import type { ConversationContext } from './ConversationContext';

/**
 * 跨层感知事件契约——唯一真相源。Kernel 内核与 Cognition 认知核共用。禁止任何平台私有字段（user_id/group_id/CQ码）进入。
 */
export interface PerceptionEvent {
  /**
   * 事件唯一 ID（由入站防腐层生成）
   */
  id: string;
  /**
   * 全链路追踪 ID（UUIDv4），从防腐网关注入，贯穿 LLM 推理、向量检索全流程
   */
  trace_id?: string;
  /**
   * 感知类型：chat / voice / vision 等
   */
  sensoryType: string;
  /**
   * 感知来源键；只标识来源通道，不再承担 scene、conversation 或 actor 语义。
   */
  source: string;
  /**
   * Unix 毫秒时间戳
   */
  timestamp: number;
  /**
   * 对话对象熟悉度 0-10，由 Vessel Cortex 计算后注入
   */
  familiarity: number;
  /**
   * 寻址模式：direct=明确呼唤；ambient=环境感知
   */
  address_mode: 'direct' | 'ambient';
  /**
   * 响应策略：reply_allowed=允许 Cognition 生成并外发回复；observe_only=只作为经历/情绪/记忆输入，不生成外显回复
   */
  response_policy: 'reply_allowed' | 'observe_only';
  conversation: ConversationContext;
  origin: SourceDescriptor;
  /**
   * 该来源最多允许被 Cognition 保留到哪一层；最终是否保留仍由 Cognition 判断。
   */
  retention_ceiling: 'transient' | 'experience' | 'memory_candidate';
  content: PerceptionContent;
}
/**
 * Kernel 已解析的规范会话上下文；Cognition 只消费此结构，不解释平台地址。
 */

export interface SourceDescriptor {
  provider_kind: 'core' | 'extension' | 'mcp' | 'user';
  provider_id: string;
  provider_version?: string | null;
  contribution_id?: string | null;
  source_event_id: string;
  schema_ref: string;
  content_hash?: string | null;
  trust_tier: 'untrusted' | 'user_asserted' | 'host_verified' | 'authoritative';
  privacy_class: 'public' | 'private' | 'sensitive';
  cognitive_effect: 'observation' | 'context' | 'action_result' | 'evidence_proposal';
}
export interface PerceptionContent {
  /**
   * 注入 LLM 的完整上下文文本。内核层不应对此字段做平台特定解析
   */
  text?: string | null;
  /**
   * 模态列表：text / image / video
   */
  modality: string[];
  /**
   * 归一化语义发言者 ID，不得使用平台原始用户 ID
   */
  actor_id?: string | null;
  /**
   * 发言者展示名，用于关系观察和经历召回
   */
  actor_name?: string | null;
  /**
   * 结构化多模态项
   */
  items?: PerceptionModalityItem[];
}
export interface PerceptionModalityItem {
  modality: 'text' | 'image' | 'video';
  text?: string | null;
  uri?: string | null;
  mime_type?: string | null;
  semantic?: PerceptionModalitySemantic;
  metadata?: {
    [k: string]: unknown;
  };
}
export interface PerceptionModalitySemantic {
  text: string;
  source?: string | null;
  resolved?: boolean | null;
  confidence?: number | null;
}
