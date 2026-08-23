export interface ConversationAddress {
  readonly provider_id: string;
  readonly provider_account_id: string;
  readonly space_kind: 'personal' | 'direct' | 'group' | 'channel' | 'thread' | 'world' | 'custom';
  readonly external_space_key: string;
  readonly external_thread_key?: string | null;
  readonly parent_space_key?: string | null;
  readonly actor_endpoint_key?: string | null;
  readonly actor_display_name?: string | null;
  readonly continuity_key?: string | null;
  readonly visibility: 'private' | 'shared' | 'public';
}

export interface ConversationContext {
  readonly source_provider_id: string;
  readonly scene_id: string;
  readonly conversation_id: string;
  readonly continuity_id: string;
  readonly thread_id: string;
  readonly interaction_id: string;
  readonly recall_scope: 'conversation_private' | 'actor_private' | 'space_local' | 'character_internal' | 'global_safe' | 'public';
  readonly disclosure_scope: 'conversation_private' | 'actor_private' | 'space_local' | 'global_safe' | 'public';
}

export interface SourceDescriptor {
  readonly provider_kind: 'core' | 'extension' | 'mcp' | 'user';
  readonly provider_id: string;
  readonly provider_version?: string | null;
  readonly contribution_id?: string | null;
  readonly source_event_id: string;
  readonly schema_ref: string;
  readonly content_hash?: string | null;
  readonly trust_tier: 'untrusted' | 'user_asserted' | 'host_verified' | 'authoritative';
  readonly privacy_class: 'public' | 'private' | 'sensitive';
  readonly cognitive_effect: 'observation' | 'context' | 'action_result' | 'evidence_proposal';
}

export interface PerceptionModalityItem {
  readonly modality: 'text' | 'image' | 'video';
  readonly text?: string | null;
  readonly uri?: string | null;
  readonly mime_type?: string | null;
  readonly semantic?: {
    readonly text: string;
    readonly source?: string | null;
    readonly resolved?: boolean | null;
    readonly confidence?: number | null;
  };
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PerceptionEvent {
  readonly id: string;
  readonly trace_id?: string;
  readonly sensoryType: string;
  readonly source: string;
  readonly timestamp: number;
  readonly familiarity: number;
  readonly address_mode: 'direct' | 'ambient';
  readonly response_policy: 'reply_allowed' | 'observe_only';
  readonly conversation: ConversationContext;
  readonly origin: SourceDescriptor;
  readonly retention_ceiling: 'transient' | 'experience' | 'memory_candidate';
  readonly content: {
    readonly text?: string | null;
    readonly modality: string[];
    readonly actor_id?: string | null;
    readonly actor_name?: string | null;
    readonly items?: PerceptionModalityItem[];
  };
}

export interface TTSSynthesizeRequest {
  readonly text: string;
  readonly output_path?: string;
  readonly trace_id?: string;
}

export interface TTSSynthesizeResponse {
  readonly status: 'success' | 'error';
  readonly output_path?: string;
  readonly provider_id?: string;
  readonly fallback_used?: boolean;
  readonly duration_ms?: number;
  readonly message?: string;
}

export interface ASRRecognizeRequest {
  readonly audio_path: string;
  readonly trace_id?: string;
}

export interface ASRRecognizeResponse {
  readonly status: 'success' | 'error';
  readonly text?: string;
  readonly provider_id?: string;
  readonly duration_ms?: number;
  readonly message?: string;
}

export interface EmotionSnapshot {
  readonly emotion_type?: string;
  readonly intensity?: number;
  readonly trigger?: string | null;
  readonly [field: string]: unknown;
}

export interface ActionCommand {
  readonly trace_id: string;
  readonly action_type: 'reply' | 'recall' | 'react' | 'skill_request' | 'noop';
  readonly target: { readonly scene_id: string; readonly channel_hint?: string | null };
  readonly payload: {
    readonly text?: string | null;
    readonly messages?: ReadonlyArray<{
      readonly sequence: number;
      readonly content_type: 'text' | 'code';
      readonly text: string;
      readonly language?: string | null;
    }>;
    readonly items?: ReadonlyArray<{
      readonly type: 'image' | 'audio' | 'sticker';
      readonly uri?: string | null;
      readonly mime_type?: string | null;
    }>;
    readonly skill_request?: {
      readonly original_goal: string;
      readonly capability_kind: string;
      readonly confidence: number;
      readonly reason?: string | null;
      readonly planning_hint?: string | null;
      readonly conversation: ConversationContext;
    };
  };
  readonly emotion_state?: EmotionSnapshot;
}

export interface KnowledgeBaseConfig {
  readonly version: string;
  readonly retrieval: {
    readonly mode: 'full_injection' | 'semantic_rag';
    readonly top_k: number;
    readonly min_score: number;
    readonly semantic_weight: number;
  };
  readonly entries: ReadonlyArray<{
    readonly entry_id: string;
    readonly scope: 'knowledge';
    readonly content: string;
    readonly priority: number;
    readonly enabled: boolean;
  }>;
}

export interface ConversationHistoryEntry {
  readonly entry_id: string;
  readonly source_kind: 'conversation' | 'notice' | 'transient';
  readonly role: 'user' | 'assistant' | 'system';
  readonly status: 'committed' | 'pending' | 'thinking' | 'failed' | 'notice';
  readonly text: string;
  readonly title?: string;
  readonly occurred_at: string;
  readonly trace_id?: string;
  readonly interaction_id?: string;
  readonly moment_id?: string;
  readonly position?: number;
  readonly conversation_id: string;
  readonly scene_id: string;
  readonly thread_id: string;
  readonly actor_id?: string;
  readonly actor_name?: string;
  readonly recall_scope: string;
  readonly disclosure_scope: string;
}

export interface ConversationHistoryResult {
  readonly request_id: string;
  readonly status: 'success' | 'error';
  readonly conversation?: {
    readonly source_provider_id: string;
    readonly scene_id: string;
    readonly conversation_id: string;
    readonly thread_id: string;
    readonly actor_id?: string;
    readonly actor_name?: string;
    readonly recall_scope: string;
    readonly disclosure_scope: string;
  };
  readonly items: ConversationHistoryEntry[];
  readonly has_more: boolean;
  readonly next_cursor?: string;
  readonly message?: string;
}

export interface CognitiveActivitySnapshot {
  readonly state: string;
  readonly policy: { readonly frequency_hint_ms: number };
}
