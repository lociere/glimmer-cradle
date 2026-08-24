/* Extension SDK owner-local public projection；Service DTO mapping 仅位于 Adapter edge。 */

export interface ConversationNotice {
  code: string;
  level: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  action_route?: string;
  action_label?: string;
}
