/* 自动生成 — 从 CognitiveActivityPolicy.schema.json 生成，勿手动修改 */

/**
 * 认知活动态对应的资源与主动性策略投影。Cognition 拥有状态判断与策略消费，Kernel 只读取受控投影。
 */
export interface CognitiveActivityPolicy {
  /**
   * 认知循环频率建议（毫秒）—— TS LifeClock 心跳间隔的来源。quiescent=60000、ambient=45000、engaged=10000。
   */
  frequency_hint_ms: number;
  /**
   * 是否允许 Volition 主动开口。quiescent=false；ambient=true（受限）；engaged=true。
   */
  allows_proactive: boolean;
  /**
   * ReasoningService 的推理访问策略。none=禁止推理；local_only=只允许已接入的本地后端；cloud_allowed=允许已配置的远端 provider，并可降级到真实本地后端。
   */
  model_tier: 'none' | 'local_only' | 'cloud_allowed';
  /**
   * ContextAssembly 的上下文预算缩放因子。quiescent=0.0、ambient=0.6、engaged=1.0。
   */
  context_budget_factor: number;
}
