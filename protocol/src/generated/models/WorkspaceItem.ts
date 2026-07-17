/* 自动生成 — 从 WorkspaceItem.schema.json 生成，勿手动修改 */

/**
 * 全局工作区候选项，由认知 Provider 投放并按 salience 竞争进入本拍广播。
 */
export interface WorkspaceItem {
  /**
   * 工作区项唯一 ID（UUIDv4 hex，无连字符）
   */
  item_id: string;
  /**
   * 投放此项的专家模块（与 Cognition workspace provider 五件套对齐）
   */
  source: 'perception' | 'affect' | 'memory' | 'drive' | 'social';
  /**
   * 意义内容（按 source 解释，自由形态）
   */
  content: {
    [k: string]: unknown;
  };
  /**
   * 显著度 [0,1] —— 工作区竞争的排序依据，高者胜出
   */
  salience: number;
  /**
   * 投放时刻（UTC 毫秒 ISO8601）
   */
  created_at: string;
  /**
   * 衰减失效时刻（UTC 毫秒 ISO8601）；缺省表示由工作区按容量策略淘汰
   */
  decay_at?: string;
}
