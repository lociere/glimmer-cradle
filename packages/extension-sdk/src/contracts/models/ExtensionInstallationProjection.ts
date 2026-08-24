/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

/**
 * Extension Package Manager 发布的安装态投影。它只表达本机已安装版本与激活选择，不承载扩展运行事实。
 */
export interface ExtensionInstallationProjection {
  extension_id: string;
  /**
   * @minItems 1
   */
  installed_versions: [string, ...string[]];
  active_version?: string;
  active_profile?: string;
  updated_at: string;
}
