import {
  AgentSynthesisRequest,
  AgentSynthesisResponse,
  AgentToolResult,
  IPCMessageType,
  IPCRequest,
  IPCResponse,
  createSuccessResponse,
  type ConversationContext,
  normalizeReplyMessages,
} from '@glimmer-cradle/protocol';
import { randomUUID } from 'node:crypto';
import { ChannelReplyEvent } from '../../foundation/event-bus/events';
import { EventBus } from '../../foundation/event-bus/event-bus';
import { getLogger } from '../../foundation/logger/logger';
import { createTraceContext } from '../../foundation/logger/trace-context';
import { AIProxy } from '../capabilities/inference/ai-proxy';
import { SkillPlanningAppService } from '../services/skill-planning-app.service';

const logger = getLogger('skill-action-controller');

export type AgentSynthesisRequester = (request: AgentSynthesisRequest) => Promise<AgentSynthesisResponse>;

export interface ChannelReplyPublishRequest {
  traceId: string;
  sceneId: string;
  text: string;
  messages?: Parameters<typeof normalizeReplyMessages>[1];
  emotionState?: Record<string, unknown>;
}

export type ChannelReplyPublisher = (request: ChannelReplyPublishRequest) => Promise<void>;

export class SkillActionController {
  public constructor(
    private readonly _skillPlanning: SkillPlanningAppService,
    private readonly _requestSynthesis: AgentSynthesisRequester = (request) =>
      AIProxy.instance.requestAgentSynthesis(request),
    private readonly _publishReply: ChannelReplyPublisher = publishChannelReply,
  ) {}

  public async handleActionCommand(request: IPCRequest): Promise<IPCResponse> {
    const cmd = request.payload ?? {};
    const actionType = String(cmd.action_type ?? '');
    if (actionType === 'reply') {
      await this.handleReplyCommand(cmd, request.trace_id);
      return createSuccessResponse(IPCMessageType.SUCCESS_RESPONSE, request.trace_id);
    }
    if (actionType === 'skill_request') {
      await this.handleSkillRequestCommand(cmd, request.trace_id);
      return createSuccessResponse(IPCMessageType.SUCCESS_RESPONSE, request.trace_id);
    }
    return createSuccessResponse(IPCMessageType.SUCCESS_RESPONSE, request.trace_id);
  }

  private async handleReplyCommand(cmd: Record<string, any>, requestTraceId: string): Promise<void> {
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
    await this._publishReply({
      traceId,
      sceneId,
      text,
      messages: cmd.payload?.messages as Parameters<typeof normalizeReplyMessages>[1],
      emotionState: cmd.emotion_state,
    });
  }

  private async handleSkillRequestCommand(cmd: Record<string, any>, requestTraceId: string): Promise<void> {
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
    });

    let synthesis: AgentSynthesisResponse;
    try {
      synthesis = await this._requestSynthesis({
        original_goal: originalGoal,
        scene_id: sceneId,
        conversation,
        tool_results: toolResults,
        trace_id: traceId,
      });
    } catch (error) {
      logger.error('Skill 结果回传 Cognition 合成失败', {
        trace_id: traceId,
        scene_id: sceneId,
        error: normalizeError(error),
      });
      await this._publishReply({
        traceId,
        sceneId,
        text: '工具结果已经返回，但认知合成失败，稍后再试。',
      });
      return;
    }

    if (!synthesis.reply_content.trim()) {
      logger.warn('Cognition 合成返回空回复，已停止投递', { trace_id: traceId, scene_id: sceneId });
      return;
    }

    await this._publishReply({
      traceId: synthesis.trace_id || traceId,
      sceneId,
      text: synthesis.reply_content,
      emotionState: synthesis.emotion_state,
    });
  }

  private async planAndExecute(options: {
    originalGoal: string;
    sceneId: string;
    traceId: string;
    planningHint?: string;
    conversation?: ConversationContext;
  }): Promise<AgentToolResult[]> {
    const readyToolCount = this._skillPlanningReadyToolCount(options.conversation);
    let plan;
    try {
      plan = await this._skillPlanning.plan({
        userGoal: [options.originalGoal, options.planningHint].filter(Boolean).join('\n'),
        sceneId: options.sceneId,
        traceId: options.traceId,
        conversation: options.conversation,
      });
    } catch (error) {
      return [makeToolResult('skill_planning', 'error', {
        phase: 'planning',
        error: normalizeError(error),
        ready_tool_count: readyToolCount,
      }, { providerKind: 'core', providerId: 'kernel.skill-plane' })];
    }

    if (plan.suggestions.length === 0) {
      return [makeToolResult('skill_planning', 'skipped', {
        phase: 'planning',
        reason: readyToolCount === 0 ? 'no_ready_skill' : 'no_suitable_skill',
        ready_tool_count: readyToolCount,
      }, { providerKind: 'core', providerId: 'kernel.skill-plane' })];
    }

    const results: AgentToolResult[] = [];
    for (const suggestion of plan.suggestions) {
      const source = this._skillPlanning.getSkillSource(suggestion.skill_id);
      try {
        const result = await this._skillPlanning.executeSuggestion(
          suggestion,
          options.traceId,
          options.conversation,
        );
        results.push(makeToolResult(suggestion.tool_name, 'success', {
          skill_id: suggestion.skill_id,
          purpose: suggestion.purpose,
          result,
        }, source));
      } catch (error) {
        results.push(makeToolResult(suggestion.tool_name, 'error', {
          skill_id: suggestion.skill_id,
          purpose: suggestion.purpose,
          error: normalizeError(error),
        }, source));
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
): AgentToolResult {
  const invocationId = randomUUID();
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
