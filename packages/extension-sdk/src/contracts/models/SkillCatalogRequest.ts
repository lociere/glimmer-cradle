/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

export interface SkillCatalogRequest {
  /**
   * 请求 ID，用于将 Skill Catalog 响应与调用方会话匹配。
   */
  request_id: string;
}
