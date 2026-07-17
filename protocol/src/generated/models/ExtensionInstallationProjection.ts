/* 自动生成 — 从 ExtensionInstallationProjection.schema.json 生成，勿手动修改 */

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
  updated_at: string;
}
