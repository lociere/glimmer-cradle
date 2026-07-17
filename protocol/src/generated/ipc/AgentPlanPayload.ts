/* 自动生成 — 从 AgentPlanPayload.schema.json 生成，勿手动修改 */

/**
 * Agent 任务规划消息载荷。跨层单一事实源，Kernel 内核与 Cognition 认知核共用。
 */
export interface AgentPlanPayload {
  /**
   * 用户目标描述
   */
  user_goal: string;
  /**
   * 场景 ID
   */
  scene_id: string;
  /**
   * 当前可规划的 ready Skill 工具目录（由 Kernel 从 SkillCatalogSnapshot 投影）
   */
  available_tools: SkillToolDescriptor[];
  [k: string]: unknown;
}
/**
 * 供 Cognition 规划、由 Kernel 统一执行的 Skill 工具描述。
 */
export interface SkillToolDescriptor {
  /**
   * Skill 的稳定目录 ID
   */
  skill_id: string;
  /**
   * Skill 内工具名
   */
  tool_name: string;
  /**
   * 工具用途说明
   */
  description: string;
  /**
   * 工具参数 JSON Schema 投影
   */
  parameters: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
