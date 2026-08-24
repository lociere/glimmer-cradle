/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

export interface ConfigurationModelAlias {
  /**
   * 稳定模型别名。
   */
  alias: string;
  /**
   * Provider 实际模型 ID。
   */
  model_id: string;
}
