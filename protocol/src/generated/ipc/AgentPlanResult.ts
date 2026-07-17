/* 自动生成 — 从 AgentPlanResult.schema.json 生成，勿手动修改 */

/**
 * Agent 任务规划响应。Cognition 只提出建议，执行始终由 Kernel 的 SkillInvocationGateway 负责。
 */
export interface AgentPlanResult {
  /**
   * 规划摘要
   */
  summary: string;
  /**
   * 供审计和 UI 投影使用的简短规划理由
   */
  reasoning: string;
  /**
   * 按执行优先级排序的受目录约束建议
   */
  suggestions: SkillToolSuggestion[];
  /**
   * 调用链 trace ID
   */
  trace_id: string;
  [k: string]: unknown;
}
export interface SkillToolSuggestion {
  /**
   * 来自规划目录的 Skill ID
   */
  skill_id: string;
  /**
   * 来自规划目录的工具名
   */
  tool_name: string;
  /**
   * 建议调用该工具的原因
   */
  purpose: string;
  /**
   * 建议置信度
   */
  confidence: number;
  /**
   * 建议参数；Kernel 执行前仍会经过策略与调用校验
   */
  arguments_hint: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
