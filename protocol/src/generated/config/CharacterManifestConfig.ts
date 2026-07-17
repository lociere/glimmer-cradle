/* 自动生成 — 从 CharacterManifestConfig.schema.json 生成，勿手动修改 */

/**
 * 角色包 manifest。它声明角色包身份、最小名称锚点、persona mode、资产目录、知识索引和迁移目录；不承载长人设或安全红线正文。
 */
export interface CharacterManifestConfig {
  character_id: string;
  base: BaseCharacter;
  /**
   * 人格模式：api/local_base 由 profile.yaml 与 dialogue.yaml 提供风格和呈现策略；local_finetune 表示主要风格已烘焙进模型权重，运行时保留最小身份、安全边界与必要对话策略。
   */
  persona_mode: 'api' | 'local_base' | 'local_finetune';
  assets: CharacterAssets;
  knowledge: CharacterKnowledge;
  migrations: CharacterMigrations;
}
export interface BaseCharacter {
  /**
   * 角色正式名（英文 / 拼音）
   */
  name: string;
  /**
   * 角色昵称 / 中文名
   */
  nickname: string;
}
export interface CharacterAssets {
  root: string;
}
export interface CharacterKnowledge {
  index: string;
}
export interface CharacterMigrations {
  root: string;
}
