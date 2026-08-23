import { randomUUID } from 'node:crypto';
import { create } from '@bufbuild/protobuf';
import {
  AddressMode,
  CancelPerceptionRequestSchema,
  ConversationContextSchema,
  GetConversationHistoryRequestSchema,
  GetPerceptionOperationRequestSchema,
  HeartbeatRequestSchema,
  InitializeKnowledgeRequestSchema,
  PlanRequestSchema,
  GetReadinessRequestSchema,
  ResponsePolicy,
  RetentionCeiling,
  PerceptionOperationState as WirePerceptionOperationState,
  ShutdownRequestSchema,
  SubmitPerceptionRequestSchema,
  SynthesizeRequestSchema,
} from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import type { KnowledgeBaseConfig, PerceptionEvent } from '@glimmer-cradle/protocol';
import type {
  AgentPlanRequest,
  AgentPlanResponse,
  AgentSynthesisRequest,
  AgentSynthesisResponse,
  ConversationHistoryRequest,
  ConversationHistoryResponse,
  LifeHeartbeatResponse,
  PerceptionCancelRequest,
  PerceptionOperationResult,
} from '../../foundation/ports/cognition-service-port';
import { getCurrentSpanId } from '../../foundation/logger/trace-context';
import { KernelCognitionTransport, objectToStruct, structToObject } from './kernel-cognition-transport';

export class CognitionClient {
  public constructor(private readonly transport = KernelCognitionTransport.instance) {}

  public async submitPerception(request: PerceptionEvent, traceId: string, timeoutMs: number): Promise<PerceptionOperationResult> {
    const call = this.transport.makeCallMetadata({
      traceId,
      spanId: getCurrentSpanId(),
      correlationId: request.conversation.interaction_id,
      causationId: request.id,
      idempotencyKey: `perception:${request.id}`,
    });
    const response = await this.transport.call(
      this.transport.methods.SubmitPerception,
      create(SubmitPerceptionRequestSchema, {
        call,
        perceptionId: request.id,
        sensoryType: request.sensoryType,
        source: request.source,
        timestampMs: request.timestamp,
        familiarity: request.familiarity,
        addressMode: request.address_mode === 'ambient' ? AddressMode.AMBIENT : AddressMode.DIRECT,
        responsePolicy: request.response_policy === 'observe_only' ? ResponsePolicy.OBSERVE_ONLY : ResponsePolicy.REPLY_ALLOWED,
        conversation: mapConversation(request.conversation),
        origin: request.origin ? {
          providerKind: request.origin.provider_kind,
          providerId: request.origin.provider_id,
          providerVersion: request.origin.provider_version ?? '',
          contributionId: request.origin.contribution_id ?? '',
          sourceEventId: request.origin.source_event_id,
          schemaRef: request.origin.schema_ref,
          contentHash: request.origin.content_hash ?? '',
          trustTier: request.origin.trust_tier,
          privacyClass: request.origin.privacy_class,
          cognitiveEffect: request.origin.cognitive_effect,
        } : undefined,
        retentionCeiling: request.retention_ceiling === 'transient'
          ? RetentionCeiling.TRANSIENT
          : request.retention_ceiling === 'experience'
            ? RetentionCeiling.EXPERIENCE
            : RetentionCeiling.MEMORY_CANDIDATE,
        content: {
          text: request.content.text ?? '',
          modality: request.content.modality,
          actorId: request.content.actor_id ?? '',
          actorName: request.content.actor_name ?? '',
          items: request.content.items?.map((item) => ({
            modality: item.modality,
            text: item.text ?? '',
            uri: item.uri ?? '',
            mimeType: item.mime_type ?? '',
            semantic: item.semantic ? {
              text: item.semantic.text,
              source: item.semantic.source ?? '',
              resolved: item.semantic.resolved ?? undefined,
              confidence: item.semantic.confidence ?? undefined,
            } : undefined,
            metadata: objectToStruct(item.metadata),
          })) ?? [],
        },
      }),
      { timeoutMs, traceId },
    );
    return mapPerceptionOperation(response.operationId, response.state);
  }

  public async cancelPerception(request: PerceptionCancelRequest, timeoutMs: number): Promise<PerceptionOperationResult> {
    const traceId = randomUUID();
    const response = await this.transport.call(
      this.transport.methods.CancelPerception,
      create(CancelPerceptionRequestSchema, {
        call: this.transport.makeCallMetadata({ traceId, idempotencyKey: `cancel:${request.target_trace_id}` }),
        targetTraceId: request.target_trace_id,
        sceneId: request.scene_id ?? '',
        reason: request.reason ?? 'superseded',
      }),
      { timeoutMs, traceId },
    );
    return {
      ...mapPerceptionOperation(response.operationId, response.state),
      terminal: response.terminal,
    };
  }

  public async perceptionOperation(operationId: string, timeoutMs: number): Promise<PerceptionOperationResult> {
    const traceId = randomUUID();
    const response = await this.transport.call(
      this.transport.methods.GetPerceptionOperation,
      create(GetPerceptionOperationRequestSchema, {
        call: this.transport.makeCallMetadata({ traceId, correlationId: operationId }),
        operationId,
      }),
      { timeoutMs, traceId },
    );
    return {
      ...mapPerceptionOperation(response.operationId, response.state),
      terminal: response.terminal,
      safe_message: response.safeMessage || undefined,
    };
  }

  public async initializeKnowledge(config: KnowledgeBaseConfig, timeoutMs: number): Promise<void> {
    const traceId = randomUUID();
    await this.transport.call(
      this.transport.methods.InitializeKnowledge,
      create(InitializeKnowledgeRequestSchema, {
        call: this.transport.makeCallMetadata({ traceId, idempotencyKey: `knowledge:${config.version}` }),
        version: config.version,
        retrieval: {
          mode: config.retrieval.mode,
          topK: config.retrieval.top_k,
          minScore: config.retrieval.min_score,
          semanticWeight: config.retrieval.semantic_weight,
        },
        entries: config.entries.map((entry) => ({
          entryId: entry.entry_id,
          scope: entry.scope,
          content: entry.content,
          enabled: entry.enabled,
          priority: entry.priority,
        })),
      }),
      { timeoutMs, traceId },
    );
  }

  public async plan(request: AgentPlanRequest, traceId: string, timeoutMs: number): Promise<AgentPlanResponse> {
    const response = await this.transport.call(
      this.transport.methods.Plan,
      create(PlanRequestSchema, {
        call: this.transport.makeCallMetadata({ traceId, correlationId: traceId }),
        userGoal: request.user_goal,
        sceneId: request.scene_id ?? 'default',
        availableTools: request.available_tools?.map((tool) => ({
          skillId: tool.skill_id,
          toolName: tool.tool_name,
          description: tool.description,
          parametersSchema: objectToStruct(tool.parameters),
        })) ?? [],
      }),
      { timeoutMs, traceId },
    );
    return {
      summary: response.summary,
      reasoning: response.reasoning,
      suggestions: response.suggestions.map((item) => ({
        skill_id: item.skillId,
        tool_name: item.toolName,
        purpose: item.purpose,
        confidence: item.confidence,
        arguments_hint: structToObject(item.argumentsHint),
      })),
      trace_id: response.traceId,
    };
  }

  public async synthesize(request: AgentSynthesisRequest, timeoutMs: number, signal?: AbortSignal): Promise<AgentSynthesisResponse> {
    const traceId = request.trace_id || randomUUID();
    const response = await this.transport.call(
      this.transport.methods.Synthesize,
      create(SynthesizeRequestSchema, {
        call: this.transport.makeCallMetadata({ traceId, correlationId: request.conversation?.interaction_id ?? traceId }),
        originalGoal: request.original_goal,
        sceneId: request.scene_id ?? 'default',
        conversation: request.conversation ? mapConversation(request.conversation) : undefined,
        toolResults: request.tool_results.map((result) => ({
          toolName: result.tool_name,
          status: result.status,
          resultJson: result.result_json,
          invocationId: result.invocation_id,
          providerKind: result.provider_kind,
          providerId: result.provider_id,
          providerVersion: result.provider_version ?? '',
          sourceEventId: result.source_event_id,
          schemaRef: result.schema_ref,
        })),
      }),
      { timeoutMs, traceId, signal },
    );
    return { reply_content: response.replyContent, emotion_state: structToObject(response.emotionState), trace_id: response.traceId };
  }

  public async conversationHistory(request: ConversationHistoryRequest, traceId: string, timeoutMs: number): Promise<ConversationHistoryResponse> {
    const response = await this.transport.call(
      this.transport.methods.GetConversationHistory,
      create(GetConversationHistoryRequestSchema, {
        call: this.transport.makeCallMetadata({ traceId, correlationId: request.request_id }),
        requestId: request.request_id,
        conversationId: request.conversation_id,
        sceneId: request.scene_id,
        threadId: request.thread_id,
        actorId: request.actor_id ?? '',
        actorName: request.actor_name ?? '',
        sourceProviderId: request.source_provider_id,
        cursor: request.cursor ?? '',
        limit: request.limit ?? 50,
        allowedScopes: request.allowed_scopes,
      }),
      { timeoutMs, traceId },
    );
    return {
      request_id: response.requestId,
      status: response.status as 'success' | 'error',
      conversation: response.conversation ? unmapConversation(response.conversation) : undefined,
      items: response.items.map((item) => ({
        entry_id: item.entryId,
        source_kind: item.sourceKind as 'conversation' | 'notice' | 'transient',
        role: item.role as 'user' | 'assistant' | 'system',
        status: item.status as 'committed' | 'pending' | 'thinking' | 'failed' | 'notice',
        text: item.text,
        title: item.title || undefined,
        occurred_at: item.occurredAt,
        trace_id: item.traceId || undefined,
        interaction_id: item.interactionId || undefined,
        moment_id: item.momentId || undefined,
        position: Number(item.position),
        conversation_id: item.conversationId,
        scene_id: item.sceneId,
        thread_id: item.threadId,
        actor_id: item.actorId || undefined,
        actor_name: item.actorName || undefined,
        recall_scope: item.recallScope,
        disclosure_scope: item.disclosureScope,
      })),
      next_cursor: response.nextCursor || undefined,
      has_more: response.hasMore,
      message: response.message || undefined,
    };
  }

  public async heartbeat(timeoutMs: number): Promise<LifeHeartbeatResponse> {
    const traceId = randomUUID();
    const response = await this.transport.call(
      this.transport.methods.Heartbeat,
      create(HeartbeatRequestSchema, { call: this.transport.makeCallMetadata({ traceId }) }),
      { timeoutMs, traceId },
    );
    return { status: response.status as 'alive' };
  }

  public async readiness(timeoutMs: number): Promise<{ state: string; phase: string; generation: string }> {
    const traceId = randomUUID();
    const response = await this.transport.call(
      this.transport.methods.GetReadiness,
      create(GetReadinessRequestSchema, { call: this.transport.makeCallMetadata({ traceId }) }),
      { timeoutMs, traceId },
    );
    return response;
  }

  public async shutdown(reason: string, timeoutMs: number): Promise<void> {
    const traceId = randomUUID();
    await this.transport.call(
      this.transport.methods.Shutdown,
      create(ShutdownRequestSchema, {
        call: this.transport.makeCallMetadata({ traceId, idempotencyKey: `shutdown:${this.transport.generation}` }),
        reason,
      }),
      { timeoutMs, traceId },
    );
  }
}

function mapPerceptionOperation(operationId: string, state: WirePerceptionOperationState): PerceptionOperationResult {
  const mapped = state === WirePerceptionOperationState.ACCEPTED
    ? 'accepted'
    : state === WirePerceptionOperationState.RUNNING
      ? 'running'
      : state === WirePerceptionOperationState.SUCCEEDED
        ? 'succeeded'
        : state === WirePerceptionOperationState.CANCELLED
          ? 'cancelled'
          : 'failed';
  return {
    operation_id: operationId,
    state: mapped,
    terminal: mapped === 'succeeded' || mapped === 'cancelled' || mapped === 'failed',
  };
}

function mapConversation(input: any) {
  return create(ConversationContextSchema, {
    sourceProviderId: input.source_provider_id,
    sceneId: input.scene_id,
    conversationId: input.conversation_id,
    continuityId: input.continuity_id,
    threadId: input.thread_id,
    interactionId: input.interaction_id,
    recallScope: input.recall_scope,
    disclosureScope: input.disclosure_scope,
  });
}

function unmapConversation(input: any) {
  return {
    source_provider_id: input.sourceProviderId,
    scene_id: input.sceneId,
    conversation_id: input.conversationId,
    continuity_id: input.continuityId,
    thread_id: input.threadId,
    interaction_id: input.interactionId,
    recall_scope: input.recallScope,
    disclosure_scope: input.disclosureScope,
  };
}
