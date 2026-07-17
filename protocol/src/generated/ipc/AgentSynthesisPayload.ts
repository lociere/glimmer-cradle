/* 自动生成 — 从 AgentSynthesisPayload.schema.json 生成，勿手动修改 */

import type { ConversationContext } from '../models/ConversationContext';

/**
 * Agent Skill/工具结果合成消息载荷。跨层单一事实源，Kernel 内核与 Cognition 认知核共用。
 */
export interface AgentSynthesisPayload {
  /**
   * 原始用户目标
   */
  original_goal: string;
  /**
   * 场景 ID
   */
  scene_id: string;
  conversation: ConversationContext;
  /**
   * 工具执行结果列表
   */
  tool_results: AgentToolResult[];
  [k: string]: unknown;
}
/**
 * Kernel 已解析的规范会话上下文；Cognition 只消费此结构，不解释平台地址。
 */

export interface AgentToolResult {
  /**
   * 工具名
   */
  tool_name: string;
  /**
   * 执行状态
   */
  status: 'success' | 'error' | 'skipped';
  /**
   * JSON 序列化的结果内容
   */
  result_json: string;
  invocation_id: string;
  provider_kind: 'core' | 'extension' | 'mcp' | 'user';
  provider_id: string;
  provider_version?: string;
  source_event_id: string;
  schema_ref: string;
  [k: string]: unknown;
}
