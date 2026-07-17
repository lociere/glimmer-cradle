import { SkillPolicyEngine } from './skill-policy-engine';
import {
  SkillRegistry,
  resolvePromptAudience,
  resolveResourceAudience,
  resolveSkillAudience,
  resolveToolAudience,
} from './skill-registry';
import type { SkillDescriptor, SkillPolicy, SkillProviderKind } from './types';
import type { SkillPolicyDecision } from './skill-policy-engine';
import { counter, histogram } from '../../foundation/logger/metrics';
import { getCurrentTraceId, newTraceId, withTrace } from '../../foundation/logger/trace-context';
import { getLogger } from '../../foundation/logger/logger';
import {
  OBSERVABILITY_EVENT_TYPES,
  appendAuditRecord,
  recordObservabilityEvent,
} from '../../foundation/observability/plane';
import type { ConversationContext } from '@glimmer-cradle/protocol';
import { isCapabilityScopeVisible } from './scope';

export interface SkillInvocationRequest {
  skillId: string;
  toolName: string;
  args: unknown;
  traceId?: string;
  conversation?: ConversationContext;
}

export interface SkillResourceReadRequest {
  skillId: string;
  resourceId: string;
  args?: unknown;
  traceId?: string;
  conversation?: ConversationContext;
}

export interface SkillPromptRenderRequest {
  skillId: string;
  promptId: string;
  args?: unknown;
  traceId?: string;
  conversation?: ConversationContext;
}

export type SkillInvocationTargetKind = 'tool' | 'resource' | 'prompt';

export type SkillInvocationAuditStatus = 'policy_denied' | 'succeeded' | 'failed';

export interface SkillInvocationAuditRecord {
  timestamp: string;
  trace_id: string;
  provider_kind: SkillProviderKind;
  provider_id: string;
  skill_id: string;
  target_kind: SkillInvocationTargetKind;
  target_name: string;
  policy_decision: SkillPolicyDecision;
  status: SkillInvocationAuditStatus;
  duration_ms: number;
  result_type?: string;
  error_message?: string;
}

export interface SkillInvocationAuditSink {
  record(record: SkillInvocationAuditRecord): void;
}

export interface SkillConfirmationRequest {
  traceId: string;
  skillId: string;
  targetKind: SkillInvocationTargetKind;
  targetName: string;
  riskLevel: SkillPolicy['riskLevel'];
  sideEffects: string[];
  args?: unknown;
}

export type SkillConfirmationRequester = (request: SkillConfirmationRequest) => Promise<boolean>;

const logger = getLogger('skill-invocation');

class LoggingSkillInvocationAuditSink implements SkillInvocationAuditSink {
  public record(record: SkillInvocationAuditRecord): void {
    const meta = {
      provider_id: record.provider_id,
      provider_kind: record.provider_kind,
      skill_id: record.skill_id,
      tool_name: record.target_kind === 'tool' ? record.target_name : undefined,
      target_kind: record.target_kind,
      target_name: record.target_name,
      policy_allowed: record.policy_decision.allowed,
      confirmation_required: record.policy_decision.confirmationRequired,
      duration_ms: record.duration_ms,
      result_type: record.result_type,
      error: record.error_message,
      trace_id: record.trace_id,
    };

    if (record.status === 'succeeded') {
      logger.info('Skill 调用完成', meta);
      return;
    }

    logger.warn(record.status === 'policy_denied' ? 'Skill 调用被策略拒绝' : 'Skill 调用失败', meta);
  }
}

export class SkillInvocationGateway {
  constructor(
    private readonly _registry: SkillRegistry = SkillRegistry.instance,
    private readonly _policyEngine: SkillPolicyEngine = new SkillPolicyEngine(),
    private readonly _auditSink: SkillInvocationAuditSink = new LoggingSkillInvocationAuditSink(),
    private readonly _requestConfirmation?: SkillConfirmationRequester,
  ) {}

  public async invoke(request: SkillInvocationRequest): Promise<unknown> {
    const registered = this._registry.findById(request.skillId);
    if (!registered) {
      throw new Error(`技能不存在: ${request.skillId}`);
    }

    const tool = registered.skill.tools.find((item) => item.name === request.toolName);
    if (!tool) {
      throw new Error(`技能 ${request.skillId} 未提供工具: ${request.toolName}`);
    }
    if (resolveSkillAudience(registered.skill) !== 'character' || resolveToolAudience(registered.skill, tool) !== 'character') {
      throw new Error(`技能 ${request.skillId}.${request.toolName} 未暴露给角色使用`);
    }
    this.assertScopeVisible(registered.skill.scope, tool.scope, request.conversation, `${request.skillId}.${request.toolName}`);

    return this.executeWithAudit({
      traceId: request.traceId,
      skill: registered.skill,
      policy: tool.policy,
      targetKind: 'tool',
      targetName: request.toolName,
      args: request.args,
      execute: () => tool.handler(request.args),
    });
  }

  public async readResource(request: SkillResourceReadRequest): Promise<unknown> {
    const registered = this._registry.findById(request.skillId);
    if (!registered) {
      throw new Error(`技能不存在: ${request.skillId}`);
    }

    const resource = registered.skill.resources?.find((item) => item.id === request.resourceId);
    if (!resource) {
      throw new Error(`技能 ${request.skillId} 未提供资源: ${request.resourceId}`);
    }
    if (resolveSkillAudience(registered.skill) !== 'character'
      || resolveResourceAudience(registered.skill, resource) !== 'character') {
      throw new Error(`技能 ${request.skillId}.${request.resourceId} 未暴露给角色使用`);
    }
    this.assertScopeVisible(registered.skill.scope, resource.scope, request.conversation, `${request.skillId}.${request.resourceId}`);

    return this.executeWithAudit({
      traceId: request.traceId,
      skill: registered.skill,
      policy: registered.skill.policy,
      targetKind: 'resource',
      targetName: request.resourceId,
      args: request.args,
      execute: () => resource.read(request.args),
    });
  }

  public async renderPrompt(request: SkillPromptRenderRequest): Promise<unknown> {
    const registered = this._registry.findById(request.skillId);
    if (!registered) {
      throw new Error(`技能不存在: ${request.skillId}`);
    }

    const prompt = registered.skill.prompts?.find((item) => item.id === request.promptId);
    if (!prompt) {
      throw new Error(`技能 ${request.skillId} 未提供提示模板: ${request.promptId}`);
    }
    if (resolveSkillAudience(registered.skill) !== 'character'
      || resolvePromptAudience(registered.skill, prompt) !== 'character') {
      throw new Error(`技能 ${request.skillId}.${request.promptId} 未暴露给角色使用`);
    }
    this.assertScopeVisible(registered.skill.scope, prompt.scope, request.conversation, `${request.skillId}.${request.promptId}`);
    if (!prompt.render) {
      return prompt.template;
    }

    return this.executeWithAudit({
      traceId: request.traceId,
      skill: registered.skill,
      policy: registered.skill.policy,
      targetKind: 'prompt',
      targetName: request.promptId,
      args: request.args,
      execute: () => prompt.render?.(request.args),
    });
  }

  private async executeWithAudit(options: {
    traceId?: string;
    skill: SkillDescriptor;
    policy: SkillPolicy | undefined;
    targetKind: SkillInvocationTargetKind;
    targetName: string;
    args?: unknown;
    execute: () => Promise<unknown> | unknown;
  }): Promise<unknown> {
    const traceId = options.traceId ?? getCurrentTraceId() ?? newTraceId();
    return withTrace(traceId, async () => {
      const startedAt = Date.now();
      const policy = options.policy ?? options.skill.policy;
      const decision = this._policyEngine.evaluate(options.skill, policy);

      if (!decision.allowed) {
        const message = decision.reason ?? `技能 ${options.skill.id} 被策略拒绝`;
        this.recordAudit({
          traceId,
          skill: options.skill,
          targetKind: options.targetKind,
          targetName: options.targetName,
          decision,
          status: 'policy_denied',
          durationMs: Date.now() - startedAt,
          errorMessage: message,
          policy,
        });
        throw new Error(message);
      }

      if (decision.confirmationRequired) {
        if (!this._requestConfirmation) {
          const message = `技能 ${options.skill.id} 需要用户确认，但确认通道尚未接入`;
          this.recordAudit({
            traceId,
            skill: options.skill,
            targetKind: options.targetKind,
            targetName: options.targetName,
            decision: { ...decision, allowed: false, reason: message },
            status: 'policy_denied',
            durationMs: Date.now() - startedAt,
            errorMessage: message,
            policy,
          });
          throw new Error(message);
        }

        const approved = await this._requestConfirmation({
          traceId,
          skillId: options.skill.id,
          targetKind: options.targetKind,
          targetName: options.targetName,
          riskLevel: policy.riskLevel,
          sideEffects: policy.sideEffects,
          args: options.args,
        });
        if (!approved) {
          const message = `用户拒绝执行技能 ${options.skill.id}`;
          this.recordAudit({
            traceId,
            skill: options.skill,
            targetKind: options.targetKind,
            targetName: options.targetName,
            decision: { ...decision, allowed: false, reason: message },
            status: 'policy_denied',
            durationMs: Date.now() - startedAt,
            errorMessage: message,
            policy,
          });
          throw new Error(message);
        }
      }

      try {
        const result = await options.execute();
        this.recordAudit({
          traceId,
          skill: options.skill,
          targetKind: options.targetKind,
          targetName: options.targetName,
          decision,
          status: 'succeeded',
          durationMs: Date.now() - startedAt,
          resultType: describeResult(result),
          policy,
        });
        return result;
      } catch (error) {
        this.recordAudit({
          traceId,
          skill: options.skill,
          targetKind: options.targetKind,
          targetName: options.targetName,
          decision,
          status: 'failed',
          durationMs: Date.now() - startedAt,
          errorMessage: normalizeErrorMessage(error),
          policy,
        });
        throw error;
      }
    });
  }

  private recordAudit(options: {
    traceId: string;
    skill: SkillDescriptor;
    targetKind: SkillInvocationTargetKind;
    targetName: string;
    decision: SkillPolicyDecision;
    status: SkillInvocationAuditStatus;
    durationMs: number;
    policy: SkillPolicy;
    resultType?: string;
    errorMessage?: string;
  }): void {
    const labels = {
      provider_kind: options.skill.provider.kind,
      provider_id: options.skill.provider.id,
      skill_id: options.skill.id,
      target_kind: options.targetKind,
      target_name: options.targetName,
      status: options.status,
    };

    counter('skill.invocation.count', 1, labels);
    histogram('skill.invocation.duration_ms', options.durationMs, labels);

    const eventType = options.status === 'succeeded'
      ? OBSERVABILITY_EVENT_TYPES.SKILL_INVOCATION_SUCCEEDED
      : options.status === 'policy_denied'
        ? OBSERVABILITY_EVENT_TYPES.SKILL_INVOCATION_POLICY_DENIED
        : OBSERVABILITY_EVENT_TYPES.SKILL_INVOCATION_FAILED;
    recordObservabilityEvent(eventType, {
      level: options.status === 'succeeded' ? 'info' : 'warn',
      event_outcome: options.status === 'succeeded'
        ? 'succeeded'
        : options.status === 'policy_denied'
          ? 'policy_denied'
          : 'failed',
      trace_id: options.traceId,
      provider_id: options.skill.provider.id,
      skill_id: options.skill.id,
      tool_name: options.targetKind === 'tool' ? options.targetName : null,
      duration_ms: options.durationMs,
      error_kind: options.status === 'failed' ? 'skill_execution_error' : null,
      diagnostic_hint: options.errorMessage ?? null,
      attributes: {
        provider_kind: options.skill.provider.kind,
        target_kind: options.targetKind,
        target_name: options.targetName,
        confirmation_required: options.decision.confirmationRequired,
        result_type: options.resultType ?? null,
      },
    });

    if (!options.policy.audit && options.status === 'succeeded') {
      return;
    }

    const record = {
      timestamp: new Date().toISOString(),
      trace_id: options.traceId,
      provider_kind: options.skill.provider.kind,
      provider_id: options.skill.provider.id,
      skill_id: options.skill.id,
      target_kind: options.targetKind,
      target_name: options.targetName,
      policy_decision: options.decision,
      status: options.status,
      duration_ms: options.durationMs,
      result_type: options.resultType,
      error_message: options.errorMessage,
    } satisfies SkillInvocationAuditRecord;

    this._auditSink.record(record);
    appendAuditRecord({
      action: `skill.${options.targetKind}.${options.status}`,
      target_kind: options.targetKind,
      target_name: options.targetName,
      owner: 'skill_plane',
      module: 'skill-invocation-gateway',
      trace_id: options.traceId,
      provider_id: options.skill.provider.id,
      skill_id: options.skill.id,
      tool_name: options.targetKind === 'tool' ? options.targetName : null,
      risk_level: options.policy.riskLevel,
      outcome: options.status === 'succeeded'
        ? 'succeeded'
        : options.status === 'policy_denied'
          ? 'policy_denied'
          : 'failed',
      reason: options.errorMessage,
      diagnostic_hint: options.decision.reason ?? options.errorMessage ?? null,
      duration_ms: options.durationMs,
      attributes: {
        provider_kind: options.skill.provider.kind,
        target_name: options.targetName,
        confirmation_required: options.decision.confirmationRequired,
        result_type: options.resultType ?? null,
      },
    });
  }

  private assertScopeVisible(
    skillScope: SkillDescriptor['scope'],
    targetScope: SkillDescriptor['tools'][number]['scope'],
    conversation: ConversationContext | undefined,
    target: string,
  ): void {
    if (isCapabilityScopeVisible(skillScope, conversation)
      && isCapabilityScopeVisible(targetScope ?? skillScope, conversation)) return;
    throw new Error(`技能 ${target} 不属于当前会话作用域`);
  }
}

function describeResult(result: unknown): string {
  if (result === null) {
    return 'null';
  }
  if (Array.isArray(result)) {
    return 'array';
  }
  return typeof result;
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
