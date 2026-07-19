/* 自动生成 — 从 ConfigurationRouteSnapshot.schema.json 生成，勿手动修改 */

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
