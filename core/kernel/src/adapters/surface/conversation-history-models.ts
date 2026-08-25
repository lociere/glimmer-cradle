export interface ConversationHistoryRequest {
  request_id: string;
  conversation_id?: string;
  scene_id?: string;
  thread_id?: string;
  actor_id?: string;
  source_provider_id?: string;
  cursor?: string;
  limit: number;
}

export interface ConversationHistoryEntry {
  entry_id: string;
  source_kind: 'conversation' | 'notice' | 'transient';
  role: 'user' | 'assistant' | 'system';
  status: 'committed' | 'pending' | 'thinking' | 'failed' | 'notice';
  text: string;
  title?: string;
  occurred_at: string;
  trace_id?: string;
  interaction_id?: string;
  moment_id?: string;
  position?: number;
  conversation_id: string;
  scene_id: string;
  thread_id: string;
  actor_id?: string;
  actor_name?: string;
  recall_scope: string;
  disclosure_scope: string;
}

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
  next_cursor?: string;
  has_more: boolean;
  message?: string;
}
