import type {
  ConversationContext,
  ConversationHistoryResult,
  KnowledgeBaseConfig,
  PerceptionEvent,
  ActionCommand,
} from '@glimmer-cradle/protocol';

/** Kernel 应用层使用的 Cognition 用例模型；跨进程 DTO 只存在于 Service Adapter。 */
export interface PerceptionCancelRequest {
  readonly scene_id?: string;
  readonly target_trace_id: string;
  readonly reason?: string;
}

export type PerceptionOperationState = 'accepted' | 'running' | 'succeeded' | 'cancelled' | 'failed';

export interface PerceptionOperationResult {
  readonly operation_id: string;
  readonly state: PerceptionOperationState;
  readonly terminal: boolean;
  readonly safe_message?: string;
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

export interface PerceptionOperationHandle extends PerceptionOperationResult {
  readonly trace_id: string;
  readonly completion: Promise<PerceptionOperationResult>;
}

export interface CognitionProcessBootstrap {
  readonly generation: string;
  readonly kernelEndpoint: string;
  readonly registrationNonce: string;
  readonly registrationSecret: string;
}

export interface CognitionProcessTransportPort {
  readonly isRegistered: boolean;
  prepareProcess(): CognitionProcessBootstrap;
  expectProcess(processId: number): void;
  waitForRegistration(timeoutMs: number): Promise<void>;
  invalidateProcess(processId?: number, reason?: Error): Promise<void>;
  configureActionDeadline(timeoutMs: number): void;
}

export interface CognitionRequestPort {
  submitPerception(request: PerceptionEvent, traceId: string, timeoutMs: number): Promise<PerceptionOperationResult>;
  cancelPerception(request: PerceptionCancelRequest, timeoutMs: number): Promise<PerceptionOperationResult>;
  perceptionOperation(operationId: string, timeoutMs: number): Promise<PerceptionOperationResult>;
  initializeKnowledge(config: KnowledgeBaseConfig, timeoutMs: number): Promise<void>;
  plan(request: AgentPlanRequest, traceId: string, timeoutMs: number): Promise<AgentPlanResponse>;
  synthesize(request: AgentSynthesisRequest, timeoutMs: number, signal?: AbortSignal): Promise<AgentSynthesisResponse>;
  heartbeat(timeoutMs: number): Promise<LifeHeartbeatResponse>;
  conversationHistory(request: ConversationHistoryRequest, traceId: string, timeoutMs: number): Promise<ConversationHistoryResponse>;
  readiness(timeoutMs: number): Promise<{ readonly state: string; readonly phase: string; readonly generation: string }>;
  shutdown(reason: string, timeoutMs: number): Promise<void>;
}

export type CognitionLifecycleState = 'starting' | 'ready' | 'failed' | 'stopped';
export type CognitionLifecycleObserver = (state: CognitionLifecycleState, summary: string) => void;
export interface CognitionActionResult {
  /** 副作用与步骤账本均已提交；即使 deadline 同时到达也可安全确认完成。 */
  readonly status: 'completed';
}

export type CognitionActionHandler = (
  command: ActionCommand,
  signal: AbortSignal,
  operationId: string,
) => Promise<CognitionActionResult | void>;
