/* 自动生成 — 从 AvatarActionStateDocument.schema.json 生成，勿手动修改 */

/**
 * Avatar 与 Desktop main 共享的保持类动作持久化文档。
 */
export interface AvatarActionStateDocument {
  /**
   * 最后被 Avatar 接受并应在重启后恢复的保持类动作 ID。
   */
  active_action_ids: string[];
}
