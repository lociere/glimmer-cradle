/* 自动生成 — 从 AppConfig.schema.json 生成，勿手动修改 */

/**
 * 系统身份、当前角色选择与备份策略（来自 configs/system/identity.yaml）。Local Data Domain 由产品或部署环境持有，不进入业务配置。
 */
export interface AppConfig {
  identity: SystemIdentityConfig;
  character: ActiveCharacterConfig;
  backup: SystemBackupConfig;
}
/**
 * 系统身份元信息，仅用于展示、日志和扩展宿主握手。
 */
export interface SystemIdentityConfig {
  /**
   * 应用显示名称
   */
  app_name: string;
  /**
   * 语义化版本号（仅展示）
   */
  app_version: string;
}
/**
 * 当前激活角色配置。profile_root 相对 configs/，active_id 对应 configs/<profile_root>/<active_id>/。
 */
export interface ActiveCharacterConfig {
  /**
   * 当前激活角色 profile id
   */
  active_id: string;
  /**
   * 角色 profile 根目录，相对 configs/
   */
  profile_root: string;
}
/**
 * 系统自动备份策略。
 */
export interface SystemBackupConfig {
  /**
   * 是否启用自动备份
   */
  enabled: boolean;
  /**
   * 自动备份存放目录（相对项目根）
   */
  backup_dir: string;
  /**
   * 自动备份间隔（小时），0 = 不调度自动备份
   */
  interval_hours: number;
}
