import {
  type ActionCommand,
  type ConversationContext,
  normalizeReplyMessages,
} from '@glimmer-cradle/protocol';
import type {
  AgentPlanResponse,
  AgentSynthesisRequest,
  AgentSynthesisResponse,
  AgentToolResult,
  CognitionActionResult,
} from '../../foundation/ports/cognition-service-port';
import { ChannelReplyEvent } from '../../foundation/event-bus/events';
import { EventBus } from '../../foundation/event-bus/event-bus';
import { getLogger } from '../../foundation/logger/logger';
import { createTraceContext } from '../../foundation/logger/trace-context';
import { AIProxy } from '../capabilities/inference/ai-proxy';
import { SkillPlanningAppService } from '../services/skill-planning-app.service';
import { RecoveryRequiredError } from '../../foundation/exceptions';

const logger = getLogger('skill-action-controller');

export type AgentSynthesisRequester = (
  request: AgentSynthesisRequest,
  signal?: AbortSignal,
) => Promise<AgentSynthesisResponse>;

type ActionExecutionJournal = {
  readonly operationId: string;
  plan?: AgentPlanResponse;
  readonly toolResults: Map<string, AgentToolResult>;
  synthesis?: AgentSynthesisResponse;
  replyCommitted: boolean;
  recoveryRequired?: RecoveryRequiredError;
};

export interface ChannelReplyPublishRequest {
  traceId: string;
  sceneId: string;
  text: string;
  messages?: Parameters<typeof normalizeReplyMessages>[1];
  emotionState?: Record<string, unknown>;
}

export type ChannelReplyPublisher = (request: ChannelReplyPublishRequest) => Promise<void>;

export class SkillActionController {
  private readonly _journals = new Map<string, ActionExecutionJournal>();

  public constructor(
    private readonly _skillPlanning: SkillPlanningAppService,
    private readonly _requestSynthesis: AgentSynthesisRequester = (request, signal) =>
      AIProxy.instance.requestAgentSynthesis(request, signal),
    private readonly _publishReply: ChannelReplyPublisher = publishChannelReply,
  ) {}

  public async handleActionCommand(
    command: ActionCommand,
    signal?: AbortSignal,
    operationId = `action:${command.trace_id}`,
  ): Promise<CognitionActionResult | void> {
    signal?.throwIfAborted();
    const journal = this.getJournal(operationId);
    if (journal.recoveryRequired) throw journal.recoveryRequired;
    const cmd = command as Record<string, any>;
    const actionType = String(command.action_type ?? '');
    if (actionType === 'reply') {
      await this.handleReplyCommand(cmd, command.trace_id, journal, signal);
      return { status: 'completed' };
    }
    if (actionType === 'skill_request') {
      await this.handleSkillRequestCommand(cmd, command.trace_id, journal, signal);
      return { status: 'completed' };
    }
  }

  private async handleReplyCommand(
    cmd: Record<string, any>,
    requestTraceId: string,
    journal: ActionExecutionJournal,
    signal?: AbortSignal,
  ): Promise<void> {
    if (journal.replyCommitted) return;
    const traceId = String(cmd.trace_id || requestTraceId);
    const text = cmd.payload?.text;
    if (typeof text !== 'string' || !text.trim()) {
      return;
    }
    const sceneId = typeof cmd.target?.scene_id === 'string' ? cmd.target.scene_id : '';
    if (!sceneId) {
      logger.warn('ActionCommand 缺少 target.scene_id，已丢弃 reply', { trace_id: traceId });
      return;
    }
    signal?.throwIfAborted();
    await this._publishReply({
      traceId,
      sceneId,
      text,
      messages: cmd.payload?.messages as Parameters<typeof normalizeReplyMessages>[1],
      emotionState: cmd.emotion_state,
    });
    journal.replyCommitted = true;
  }

  private async handleSkillRequestCommand(
    cmd: Record<string, any>,
    requestTraceId: string,
    journal: ActionExecutionJournal,
    signal?: AbortSignal,
  ): Promise<void> {
    if (journal.replyCommitted) return;
    const traceId = String(cmd.trace_id || requestTraceId);
    const skillRequest = cmd.payload?.skill_request ?? {};
    const sceneId = String(cmd.target?.scene_id || skillRequest.scene_id || '');
    const originalGoal = String(skillRequest.original_goal || cmd.payload?.text || '').trim();
    const conversation = skillRequest.conversation;
    if (!sceneId || !originalGoal) {
      logger.warn('Skill 请求缺少目标场景或用户目标，已丢弃', {
        trace_id: traceId,
        has_scene_id: Boolean(sceneId),
        has_goal: Boolean(originalGoal),
      });
      return;
    }

    logger.info('开始处理角色 Skill 请求', {
      trace_id: traceId,
      scene_id: sceneId,
      reason: skillRequest.reason,
    });

    const toolResults = await this.planAndExecute({
      originalGoal,
      sceneId,
      traceId,
      planningHint: typeof skillRequest.planning_hint === 'string' ? skillRequest.planning_hint : undefined,
      conversation,
      signal,
      journal,
    });

    let synthesis = journal.synthesis;
    try {
      synthesis ??= await this._requestSynthesis({
          original_goal: originalGoal,
          scene_id: sceneId,
          conversation,
          tool_results: toolResults,
          trace_id: traceId,
        }, signal);
      signal?.throwIfAborted();
      journal.synthesis = synthesis;
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      logger.error('Skill 结果回传 Cognition 合成失败', {
        trace_id: traceId,
        scene_id: sceneId,
        error: normalizeError(error),
      });
      signal?.throwIfAborted();
      await this._publishReply({
        traceId,
        sceneId,
        text: '工具结果已经返回，但认知合成失败，稍后再试。',
      });
      journal.replyCommitted = true;
      return;
    }

    if (!synthesis.reply_content.trim()) {
      logger.warn('Cognition 合成返回空回复，已停止投递', { trace_id: traceId, scene_id: sceneId });
      return;
    }

    signal?.throwIfAborted();
    await this._publishReply({
      traceId: synthesis.trace_id || traceId,
      sceneId,
      text: synthesis.reply_content,
      emotionState: synthesis.emotion_state,
    });
    journal.replyCommitted = true;
  }

  private async planAndExecute(options: {
    originalGoal: string;
    sceneId: string;
    traceId: string;
    planningHint?: string;
    conversation?: ConversationContext;
    signal?: AbortSignal;
    journal: ActionExecutionJournal;
  }): Promise<AgentToolResult[]> {
    const readyToolCount = this._skillPlanningReadyToolCount(options.conversation);
    let plan = options.journal.plan;
    if (!plan) {
      try {
        plan = await this._skillPlanning.plan({
          userGoal: [options.originalGoal, options.planningHint].filter(Boolean).join('\n'),
          sceneId: options.sceneId,
          traceId: options.traceId,
          conversation: options.conversation,
        });
        options.journal.plan = plan;
      } catch (error) {
        if (isAbortError(error, options.signal)) throw error;
        const invocationId = `${options.journal.operationId}:planning`;
        return [makeToolResult('skill_planning', 'error', {
          phase: 'planning',
          error: normalizeError(error),
          ready_tool_count: readyToolCount,
        }, { providerKind: 'core', providerId: 'kernel.skill-plane' }, invocationId)];
      }
    }

    if (plan.suggestions.length === 0) {
      return [makeToolResult('skill_planning', 'skipped', {
        phase: 'planning',
        reason: readyToolCount === 0 ? 'no_ready_skill' : 'no_suitable_skill',
        ready_tool_count: readyToolCount,
      }, { providerKind: 'core', providerId: 'kernel.skill-plane' }, `${options.journal.operationId}:planning`)];
    }

    const results: AgentToolResult[] = [];
    for (const [index, suggestion] of plan.suggestions.entries()) {
      options.signal?.throwIfAborted();
      const invocationId = `${options.journal.operationId}:tool:${index}:${suggestion.skill_id}:${suggestion.tool_name}`;
      const committed = options.journal.toolResults.get(invocationId);
      if (committed) {
        results.push(committed);
        continue;
      }
      const source = this._skillPlanning.getSkillSource(suggestion.skill_id);
      try {
        const result = await this._skillPlanning.executeSuggestion(
          suggestion,
          options.traceId,
          options.conversation,
          options.signal,
          invocationId,
        );
        const toolResult = makeToolResult(suggestion.tool_name, 'success', {
          skill_id: suggestion.skill_id,
          purpose: suggestion.purpose,
          result,
        }, source, invocationId);
        options.journal.toolResults.set(invocationId, toolResult);
        results.push(toolResult);
      } catch (error) {
        if (error instanceof RecoveryRequiredError) {
          options.journal.recoveryRequired = error;
          throw error;
        }
        if (isAbortError(error, options.signal)) throw error;
        const toolResult = makeToolResult(suggestion.tool_name, 'error', {
          skill_id: suggestion.skill_id,
          purpose: suggestion.purpose,
          error: normalizeError(error),
        }, source, invocationId);
        options.journal.toolResults.set(invocationId, toolResult);
        results.push(toolResult);
      }
    }
    return results;
  }

  private _skillPlanningReadyToolCount(conversation?: ConversationContext): number {
    try {
      return this._skillPlanning.getReadyToolCount(conversation);
    } catch {
      return 0;
    }
  }

  private getJournal(operationId: string): ActionExecutionJournal {
    const existing = this._journals.get(operationId);
    if (existing) return existing;
    const created: ActionExecutionJournal = {
      operationId,
      toolResults: new Map(),
      replyCommitted: false,
    };
    this._journals.set(operationId, created);
    if (this._journals.size > 2048) {
      const disposable = [...this._journals].find(([, journal]) => (
        journal.replyCommitted || journal.recoveryRequired
      ));
      if (disposable) this._journals.delete(disposable[0]);
    }
    return created;
  }
}

async function publishChannelReply(request: ChannelReplyPublishRequest): Promise<void> {
  const messages = normalizeReplyMessages(request.text, request.messages);
  await EventBus.instance.publish(
    new ChannelReplyEvent(
      {
        trace_id: request.traceId,
        text: request.text,
        messages,
        emotion_state: request.emotionState,
        target_channel: request.sceneId,
      },
      createTraceContext({ trace_id: request.traceId }),
    ),
  );
}

function makeToolResult(
  toolName: string,
  status: AgentToolResult['status'],
  payload: Record<string, unknown>,
  source: { providerKind: AgentToolResult['provider_kind']; providerId: string },
  invocationId: string,
): AgentToolResult {
  return {
    tool_name: toolName,
    status,
    result_json: safeJsonStringify(payload),
    invocation_id: invocationId,
    provider_kind: source.providerKind,
    provider_id: source.providerId,
    source_event_id: invocationId,
    schema_ref: 'glimmer://skill/action-result/v1',
  };
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === 'AbortError');
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: 'result_not_json_serializable' });
  }
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
