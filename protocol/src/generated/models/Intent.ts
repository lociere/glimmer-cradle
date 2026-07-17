/* 自动生成 — 从 Intent.schema.json 生成，勿手动修改 */

/**
 * Volition 产出的意图。连续意愿值通过阈值后形成，经仲裁器合并、延迟或抑制，再进入行动流。
 */
export interface Intent {
  /**
   * 意图唯一 ID（UUIDv4 hex，无连字符）
   */
  intent_id: string;
  /**
   * 意图类型：reply=发声回复；silence=显式选择沉默；thought=主动思考（无外显输出）；emotion=情绪外显（如表情）；action=工具调用/MCP
   */
  type: 'reply' | 'silence' | 'thought' | 'emotion' | 'action';
  /**
   * 意图来源：reactive=对已准入感知的回应，不受主动行为意愿闸抑制；proactive=角色自发行为，必须通过意愿阈值与认知活动策略。
   */
  initiative: 'reactive' | 'proactive';
  /**
   * 连续意愿值 [0,1] —— 各权重加权求和后的结果，主动行为仲裁阈值由认知活动状态决定
   */
  willingness: number;
  /**
   * 意图载荷（按 type 解释；reply 含 text，action 含 tool_name + args 等）
   */
  payload?: {
    [k: string]: unknown;
  };
  /**
   * 因果 —— 直接催生此意图的上游 moment_id 列表（蓝图 §4.1 因果优先）
   */
  causation_ids: string[];
  /**
   * 产出时刻（UTC 毫秒 ISO8601）
   */
  created_at: string;
}
