/* 自动生成 — 从 ActionCommand.schema.json 生成，勿手动修改 */

import type { ConversationContext } from './ConversationContext';

/**
 * 跨层行为指令契约——唯一真相源。AI 层发出的行为指令，由 Kernel 内核路由到目标通道。禁止平台私有字段。
 */
export interface ActionCommand {
  /**
   * 全链路追踪 ID（与对应的 PerceptionEvent.trace_id 关联）
   */
  trace_id: string;
  /**
   * 行为类型：reply=回复消息；recall=撤回消息；react=表情反应；skill_request=请求 Kernel 经 Skill Plane 执行能力并回传 Cognition 合成；noop=沉默
   */
  action_type: 'reply' | 'recall' | 'react' | 'skill_request' | 'noop';
  target: ActionTarget;
  payload: ActionPayload;
  emotion_state?: EmotionSnapshot;
}
export interface ActionTarget {
  /**
   * 目标场景 ID（由 IdentityRouter 归一化后的 vessel_id 格式）
   */
  scene_id: string;
  /**
   * 通道提示（可选，内核路由用）
   */
  channel_hint?: string | null;
}
export interface ActionPayload {
  /**
   * 回复完整文本（action_type=reply 时必填）。这是本次认知回复的完整语义内容，用于记忆、日志和通道兜底。
   */
  text?: string | null;
  /**
   * 回复投递消息列表。用于把同一次认知回复拆成多条自然消息；缺省时由 Kernel 按完整文本规范化生成。
   */
  messages?: ActionReplyMessage[];
  /**
   * 附加多媒体项（图片/语音/表情等）
   */
  items?: ActionMediaItem[];
  skill_request?: SkillRequestPayload;
}
export interface ActionReplyMessage {
  /**
   * 同一次回复内的投递顺序，从 0 开始。
   */
  sequence: number;
  /**
   * 消息内容类型。普通对话为 text；完整代码块可为 code。
   */
  content_type: 'text' | 'code';
  /**
   * 该条投递消息的正文。
   */
  text: string;
  /**
   * content_type=code 时的语言标识。
   */
  language?: string | null;
}
export interface ActionMediaItem {
  type: 'image' | 'audio' | 'sticker';
  uri?: string | null;
  mime_type?: string | null;
}
/**
 * action_type=skill_request 时的 Skill 使用请求。Cognition 只表达目标与理由；Kernel 负责 catalog、policy、gateway、audit 与 synthesis 编排。
 */
export interface SkillRequestPayload {
  /**
   * 触发工具使用的用户目标或当前角色整理后的目标。
   */
  original_goal: string;
  /**
   * Cognition 结构化 ActionPlan 判定的能力类型，用于规划和审计，不作为授权依据。
   */
  capability_kind:
    | 'web_navigation'
    | 'realtime_lookup'
    | 'desktop_action'
    | 'clipboard'
    | 'notification'
    | 'extension_action'
    | 'mcp_tool'
    | 'platform_message'
    | 'none';
  /**
   * Cognition 对 skill_request 行动判断的置信度。
   */
  confidence: number;
  /**
   * Cognition 判断需要 Skill 的简短理由，用于审计与调试，不作为授权依据。
   */
  reason?: string | null;
  /**
   * 给 AgentPlan 的可选规划提示；Kernel 仍只暴露 ready catalog。
   */
  planning_hint?: string | null;
  conversation: ConversationContext;
}
/**
 * Kernel 已解析的规范会话上下文；Cognition 只消费此结构，不解释平台地址。
 */

export interface EmotionSnapshot {
  emotion_type?: string;
  intensity?: number;
  trigger?: string | null;
  [k: string]: unknown;
}
