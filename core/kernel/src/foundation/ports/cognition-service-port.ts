import type {
  ConversationContext,
  ConversationHistoryResult,
} from '@glimmer-cradle/protocol';

/** Kernel 应用层使用的 Cognition 用例模型；跨进程 DTO 只存在于 Service Adapter。 */
export interface PerceptionCancelRequest {
  readonly scene_id?: string;
  readonly target_trace_id: string;
  readonly reason?: string;
}

export interface AgentPlanRequest {
  readonly user_goal: string;
  readonly scene_id?: string;
  readonly available_tools: ReadonlyArray<{
    readonly skill_id: string;
    readonly tool_name: string;
    readonly description: string;
    readonly parameters?: Record<string, unknown>;
  }>;
}

export interface AgentPlanResponse {
  readonly summary: string;
  readonly reasoning: string;
  readonly suggestions: ReadonlyArray<{
    readonly skill_id: string;
    readonly tool_name: string;
    readonly purpose: string;
    readonly confidence: number;
    readonly arguments_hint: Record<string, unknown>;
  }>;
  readonly trace_id: string;
}

export interface AgentSynthesisRequest {
  readonly original_goal: string;
  readonly scene_id?: string;
  readonly conversation?: ConversationContext;
  readonly trace_id?: string;
  readonly tool_results: ReadonlyArray<AgentToolResult>;
}

export interface AgentToolResult {
  readonly tool_name: string;
  readonly status: 'success' | 'error' | 'skipped';
  readonly result_json: string;
  readonly invocation_id: string;
  readonly provider_kind: 'core' | 'extension' | 'mcp' | 'user';
  readonly provider_id: string;
  readonly provider_version?: string;
  readonly source_event_id: string;
  readonly schema_ref: string;
}

export interface AgentSynthesisResponse {
  readonly reply_content: string;
  readonly emotion_state: Record<string, unknown>;
  readonly trace_id: string;
}

export interface ConversationHistoryRequest {
  readonly request_id: string;
  readonly conversation_id: string;
  readonly scene_id: string;
  readonly thread_id: string;
  readonly actor_id?: string;
  readonly actor_name?: string;
  readonly source_provider_id: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly allowed_scopes: string[];
}

export type ConversationHistoryResponse = ConversationHistoryResult;

export interface LifeHeartbeatResponse {
  readonly status: 'alive';
}

export interface ChatMessageResponse {
  readonly reply_content?: string;
  readonly emotion_state?: Record<string, unknown>;
  readonly trace_id?: string;
}
