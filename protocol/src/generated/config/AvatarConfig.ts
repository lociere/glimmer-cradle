/* 自动生成 — 从 AvatarConfig.schema.json 生成，勿手动修改 */

/**
 * 人物 Avatar 领域配置。Unity 只是当前 Host 实现，Surface 不拥有 Avatar。
 */
export interface AvatarConfig {
  enabled: boolean;
  heartbeat_interval_ms: number;
  heartbeat_timeout_ms: number;
  host: UnityAvatarHostConfig;
  emotion_mapping: {
    [k: string]: AvatarEmotionMapping;
  };
}
/**
 * Unity Avatar Host 启动策略。manual 表示由用户启动，managed 表示由 Kernel 生命周期监督树拉起。
 */
export interface UnityAvatarHostConfig {
  launch_mode: 'manual' | 'managed';
  command: string;
  args: string[];
  cwd: string;
  env: {
    [k: string]: string;
  };
  startup_timeout_ms: number;
  restart_on_exit: boolean;
}
/**
 * 认知情绪到 Avatar 稳定动作语义的单条映射。
 */
export interface AvatarEmotionMapping {
  expression_id?: string;
  motion_group?: string;
  animator_trigger?: string;
}
