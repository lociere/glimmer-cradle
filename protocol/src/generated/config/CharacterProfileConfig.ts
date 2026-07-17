/* 自动生成 — 从 CharacterProfileConfig.schema.json 生成，勿手动修改 */

/**
 * 角色作者种子配置。它是 Character Package 的稳定人格事实源，只描述身份锚点、性格轴、关系姿态、情绪行为、场景行为与表达倾向；不进入 RAG，不写入向量库，不由运行时静默改写。
 */
export interface CharacterProfileConfig {
  identity: {
    summary: string;
    appearance?: string;
    values?: ProfileTextEntry[];
  };
  /**
   * @minItems 1
   */
  traits: [ProfileTextEntry, ...ProfileTextEntry[]];
  /**
   * @minItems 1
   */
  relationship: [ProfileTextEntry, ...ProfileTextEntry[]];
  /**
   * @minItems 1
   */
  expression: [ProfileTextEntry, ...ProfileTextEntry[]];
  emotion_behaviors: ProfileConditionalEntry[];
  context_behaviors: ProfileConditionalEntry[];
  examples: ProfileTextEntry[];
}
export interface ProfileTextEntry {
  id: string;
  content: string;
  priority: number;
  enabled: boolean;
}
export interface ProfileConditionalEntry {
  id: string;
  condition: string;
  content: string;
  priority: number;
  enabled: boolean;
}
