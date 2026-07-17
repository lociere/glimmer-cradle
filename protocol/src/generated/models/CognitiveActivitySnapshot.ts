/* 自动生成 — 从 CognitiveActivitySnapshot.schema.json 生成，勿手动修改 */

/**
 * 认知活动实时快照，嵌入 state_sync payload 跨进程透传。结构与 CognitiveActivityState、CognitiveActivityPolicy 对齐；因代码生成器不解析跨文件 $ref 而在此内联。
 */
export interface CognitiveActivitySnapshot {
  /**
   * 当前认知活动态（与 CognitiveActivityState 枚举对齐）
   */
  state: 'quiescent' | 'ambient' | 'engaged';
  /**
   * 当前态进入时间（UTC 毫秒 ISO8601）
   */
  since_at: string;
  /**
   * 当前 idle 时长（自最近一次 perception/reply Moment 起的秒数）
   */
  idle_seconds: number;
  /**
   * 当前态对应的认知资源策略（与 CognitiveActivityPolicy 等价）
   */
  policy: {
    frequency_hint_ms: number;
    allows_proactive: boolean;
    model_tier: 'none' | 'local_only' | 'cloud_allowed';
    context_budget_factor: number;
  };
}
