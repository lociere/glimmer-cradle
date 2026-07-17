/* 自动生成 — 从 SafetyConfig.schema.json 生成，勿手动修改 */

/**
 * 角色安全边界配置。它是 Character Package 的红线事实源，不承载人格叙述或外部知识。
 */
export interface SafetyConfig {
  /**
   * 自由文本形式的禁忌规则
   */
  taboos: string;
  /**
   * 严格禁止出现的短语列表
   */
  forbidden_phrases: string[];
  /**
   * 禁止匹配的正则表达式列表
   */
  forbidden_regex: string[];
}
