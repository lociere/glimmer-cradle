/* 自动生成 — 从 ConversationHistoryResult.schema.json 生成，勿手动修改 */

import type { ConversationHistoryEntry } from './ConversationHistoryEntry';

export interface ConversationHistoryResult {
  request_id: string;
  status: 'success' | 'error';
  conversation?: {
    source_provider_id: string;
    scene_id: string;
    conversation_id: string;
    thread_id: string;
    actor_id?: string;
    actor_name?: string;
    recall_scope: string;
    disclosure_scope: string;
  };
  items: ConversationHistoryEntry[];
  /**
   * 继续向更旧历史翻页时使用的不透明游标。
   */
  next_cursor?: string;
  has_more: boolean;
  message?: string;
}
