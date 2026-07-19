/* 自动生成 — 从 ConversationNotice.schema.json 生成，勿手动修改 */

export interface ConversationNotice {
  code: string;
  level: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  action_route?: string;
  action_label?: string;
}
