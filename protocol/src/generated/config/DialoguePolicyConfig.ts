/* 自动生成 — 从 DialoguePolicyConfig.schema.json 生成，勿手动修改 */

/**
 * 角色对话呈现策略配置。它只约束输出节奏、消息分段、括号动作、Markdown 与代码呈现，不承载人格事实。
 */
export interface DialoguePolicyConfig {
  presentation: {
    forbid_stage_directions?: boolean;
    forbid_emotion_labels?: boolean;
    casual_max_sentences?: number;
    casual_max_chars_per_message?: number;
    complex_reply_policy?: string;
    message_split_policy?: string;
    /**
     * @minItems 1
     */
    rules: [string, ...string[]];
  };
  structured_output: {
    preserve_markdown?: boolean;
    preserve_code_blocks?: boolean;
    require_fenced_code_blocks?: boolean;
    /**
     * @minItems 1
     */
    rules: [string, ...string[]];
  };
  normalization: {
    strip_stage_directions?: boolean;
    strip_emotion_labels?: boolean;
  };
}
