/* Kernel config Adapter 的 schema-derived Document projection；serialized shape 由 contracts/json-schema/config/v1 拥有。 */

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
