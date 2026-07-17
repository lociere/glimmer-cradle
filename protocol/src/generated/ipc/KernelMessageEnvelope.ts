/* 自动生成 — 从 KernelMessageEnvelope.schema.json 生成，勿手动修改 */

/**
 * 内核入站消息统一信封。跨层单一事实源，Kernel 内核与 Cognition 认知核共用。payload 为自由形态字典，由各消息类型的专属 payload schema 二次解析。
 */
export interface KernelMessageEnvelope {
  /**
   * 消息类型（如 perception_message / life_heartbeat / agent_plan）
   */
  type: string;
  /**
   * 全链路追踪 ID（UUIDv4 hex）。空串表示无上游 trace。
   */
  trace_id: string;
  /**
   * 父 span（跨进程 span 嵌套用，蓝图 §6.2）。空串表示无 span。
   */
  span_id: string;
  /**
   * 消息载荷（自由形态；由专属 payload schema 解析）
   */
  payload: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
