/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

export interface ConfigurationRouteSnapshot {
  /**
   * 当前默认路由的 provider key。
   */
  provider_key?: string;
  /**
   * 当前默认路由的模型别名。
   */
  model_alias?: string;
  /**
   * 当前默认路由解析后的模型 ID。
   */
  effective_model_id?: string;
  /**
   * 默认对话路由是否可执行。
   */
  ready: boolean;
  /**
   * 未就绪原因。
   */
  reason?: string;
}
