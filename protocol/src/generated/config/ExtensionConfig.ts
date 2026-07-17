/* 自动生成 — 从 ExtensionConfig.schema.json 生成，勿手动修改 */

/**
 * 扩展系统配置 —— 根目录、沙箱、默认权限、黑名单。
 */
export interface ExtensionConfig {
  /**
   * 已安装扩展包根目录（相对应用根）；源码仓库不参与运行期发现
   */
  extension_root_dir: string;
  sandbox: ExtensionSandbox;
  /**
   * 新扩展默认获得的权限列表
   */
  default_permissions: string[];
  /**
   * 扩展黑名单（ID 列表，阻止加载）
   */
  extension_blacklist: string[];
}
/**
 * 沙箱策略
 */
export interface ExtensionSandbox {
  /**
   * 是否启用扩展隔离
   */
  enable_isolation: boolean;
  /**
   * 扩展 onActivate / onDeactivate 超时（ms）
   */
  timeout_ms: number;
  /**
   * 是否允许扩展加载 native 模块
   */
  allow_native_modules: boolean;
}
