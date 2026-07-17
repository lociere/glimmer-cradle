/* 自动生成 — 从 TraceContext.schema.json 生成，勿手动修改 */

/**
 * 跨层诊断链路上下文。Kernel 与 Cognition 共享的轻量 trace 契约。
 */
export interface TraceContext {
  /**
   * 一次跨层因果关联的 trace ID。
   */
  trace_id: string;
  /**
   * 当前活动 span ID；无 span 时为 null。
   */
  span_id?: string | null;
  /**
   * 远端或上层 span ID；仅跨边界续接时存在。
   */
  parent_span_id?: string | null;
}
