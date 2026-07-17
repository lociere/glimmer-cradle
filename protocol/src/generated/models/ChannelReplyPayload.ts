/* 自动生成 — 从 ChannelReplyPayload.schema.json 生成，勿手动修改 */

/**
 * 通道回复事件载荷。Kernel 将 Cognition 的 ActionCommand 规范化为此事件，再分发给 Desktop Surfaces 或扩展适配器。属于 protocol 契约，不属于 extension-sdk 内部类型。
 */
export interface ChannelReplyPayload {
  /**
   * 全链路追踪 ID，关联 perception → cognition → reply。
   */
  trace_id: string;
  /**
   * 本次认知回复的完整文本，用于记忆、日志和不支持多消息的通道兜底。
   */
  text: string;
  /**
   * 按投递顺序排列的自然消息段。支持同一次回复拆成多条消息。
   */
  messages?: ChannelReplyMessage[];
  emotion_state?: ChannelReplyEmotionSnapshot;
  /**
   * 目标通道。Desktop 为 desktop-ui:*；平台适配器使用 napcat:* 等命名空间。
   */
  target_channel: string;
}
export interface ChannelReplyMessage {
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
export interface ChannelReplyEmotionSnapshot {
  emotion_type?: string;
  intensity?: number;
  trigger?: string | null;
  [k: string]: unknown;
}
