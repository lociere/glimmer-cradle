import { SkillPolicyEngine } from './skill-policy-engine';
import {
  SkillRegistry,
  resolvePromptAudience,
  resolveResourceAudience,
  resolveSkillAudience,
  resolveToolAudience,
} from './skill-registry';
import type {
  SkillConfirmationRequest,
  SkillConfirmationRequester,
  SkillDescriptor,
  SkillPolicy,
  SkillProviderKind,
} from '../../ports/skill-plane.port';
import type { SkillPolicyDecision } from './skill-policy-engine';
import type { ConversationContext } from '@glimmer-cradle/conversation';
import type { Logger as KernelLoggerPort, Observability as KernelObservabilityPort } from '@glimmer-cradle/platform/observability';
import type { SkillInvocationDiagnosticsPort } from '../../ports/skill-invocation-diagnostics.port';
import { ExecutionController, ExecutionRecoveryRequiredError, ExecutionResultOutbox, executionDigest, isCapabilityScopeVisible } from '@glimmer-cradle/capabilities';
import { RecoveryRequiredError } from '../../domain/errors';

export interface SkillInvocationRequest {
  skillId: string;
  toolName: string;
  args: unknown;
  traceId?: string;
  conversation?: ConversationContext;
  signal?: AbortSignal;
  /** 由反向 Service operation 派生的稳定副作用键，重试不得重新生成。 */
  invocationId?: string;
  sourceFactId?: string;
}

export class SkillInvocationRecoveryRequiredError extends RecoveryRequiredError {
  public constructor(public readonly invocationId: string) {
    super(invocationId, undefined, `技能副作用终态不明，需要人工恢复（invocation_id=${invocationId}）`);
    this.name = 'SkillInvocationRecoveryRequiredError';
    Object.setPrototypeOf(this, SkillInvocationRecoveryRequiredError.prototype);
  }
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

export type SkillInvocationAuditStatus = 'policy_denied' | 'succeeded' | 'failed' | 'unknown';

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

export class LoggingSkillInvocationAuditSink implements SkillInvocationAuditSink {
  public constructor(private readonly logger: KernelLoggerPort) {}
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
      this.logger.info('Skill 调用完成', meta);
      return;
    }

    this.logger.warn(record.status === 'policy_denied' ? 'Skill 调用被策略拒绝'
      : record.status === 'unknown' ? 'Skill 调用终态不明，需要恢复' : 'Skill 调用失败', meta);
  }
}

export class SkillInvocationGateway {
  private readonly active = new Set<Promise<unknown>>();
  private stopped = false;
  constructor(
    private readonly _registry: SkillRegistry,
    private readonly _policyEngine: SkillPolicyEngine,
    private readonly _auditSink: SkillInvocationAuditSink,
    private readonly _observability: KernelObservabilityPort,
    private readonly _diagnostics: SkillInvocationDiagnosticsPort,
    private readonly _requestConfirmation?: SkillConfirmationRequester,
    private readonly _execution?: ExecutionController,
    private readonly _newInvocationId: () => string = () => _observability.createTraceContext().trace_id,
    private readonly _resultOutbox?: ExecutionResultOutbox,
  ) {}

  public resultEventId(invocationId: string): string | undefined {
    return this._execution?.resultEvent(invocationId)?.event_id;
  }

  public invoke(request: SkillInvocationRequest): Promise<unknown> {
    if (this.stopped) return Promise.reject(new Error('Skill invocation 已停止接纳'));
    const promise = this.invokeTool(request).finally(() => this.active.delete(promise));
    this.active.add(promise);
    return promise;
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    await this._execution?.stop();
    await Promise.allSettled([...this.active]);
  }

  private async invokeTool(request: SkillInvocationRequest): Promise<unknown> {
    request.signal?.throwIfAborted();
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

    const invocationId = request.invocationId ?? (this._execution ? this._newInvocationId() : undefined);
    const handler = tool.handler;
    const definition = () => executionDigest({
      skill_id: registered.skill.id, provider: { kind: registered.skill.provider.kind, id: registered.skill.provider.id },
      audience: resolveSkillAudience(registered.skill), scope: registered.skill.scope ?? null,
      runtime_status: registered.skill.metadata?.runtime_status ?? null,
      skill_policy: registered.skill.policy, tool_name: tool.name, description: tool.description,
      tool_audience: resolveToolAudience(registered.skill, tool), tool_scope: tool.scope ?? null,
      parameters: tool.parameters ?? null, tool_policy: tool.policy ?? null,
    });
    const revision = this._execution ? definition() : '';
    const context = request.conversation ? { ...request.conversation } : undefined;
    return this.executeWithAudit({
      traceId: request.traceId,
      skill: registered.skill,
      policy: tool.policy,
      targetKind: 'tool',
      targetName: request.toolName,
      args: request.args,
      signal: request.signal,
      invocationId,
      durable: this._execution ? {
        scopeId: context?.conversation_id ?? 'global',
        executorId: registered.skill.provider.id,
        revision,
        context: context ? { conversation_id: context.conversation_id, scene_id: context.scene_id,
          source_provider_id: context.source_provider_id } : null,
        interaction: request.sourceFactId && context ? { conversation_id: context.conversation_id,
          source_fact_id: request.sourceFactId } : undefined,
        validate: () => {
          if (this._registry.findById(request.skillId) !== registered
            || !registered.skill.tools.includes(tool) || tool.handler !== handler || definition() !== revision) return false;
          this.assertScopeVisible(registered.skill.scope, tool.scope, context, `${request.skillId}.${request.toolName}`);
          return this._policyEngine.evaluate(registered.skill, tool.policy ?? registered.skill.policy).allowed;
        },
      } : undefined,
      execute: (args, signal) => handler(args, {
        signal,
        invocationId,
      }),
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
    execute: (args?: unknown, signal?: AbortSignal) => Promise<unknown> | unknown;
    signal?: AbortSignal;
    invocationId?: string;
    durable?: { scopeId: string; executorId: string; revision: string; context: unknown;
      interaction?: { conversation_id: string; source_fact_id: string }; validate(): boolean };
  }): Promise<unknown> {
    const traceId = options.traceId
      ?? this._observability.currentTraceId()
      ?? this._observability.createTraceContext().trace_id;
    return this._observability.withTrace(traceId, async () => {
      options.signal?.throwIfAborted();
      const startedAt = Date.now();
      const sourcePolicy = options.policy ?? options.skill.policy;
      const policy = { ...sourcePolicy, sideEffects: [...sourcePolicy.sideEffects] };
      const decision = this._policyEngine.evaluate(options.skill, policy);
      const authorize = async (args: unknown, signal?: AbortSignal): Promise<void> => {
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
            args,
          });
          signal?.throwIfAborted();
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
      };

      if (options.durable && this._execution && options.invocationId) {
        let originalError: unknown;
        const args = (input: unknown): unknown => {
          const body = input as { has_args: boolean; args: unknown };
          return body.has_args ? body.args : undefined;
        };
        let outcome;
        try {
          outcome = await this._execution.execute({
            invocation_id: options.invocationId, scope_id: options.durable.scopeId, idempotency_key: options.invocationId,
            target: { executor_id: options.durable.executorId,
              capability_id: `${options.skill.id}.${options.targetName}`, definition_revision: options.durable.revision },
            input: { has_args: options.args !== undefined, args: options.args ?? null, context: options.durable.context },
            ...(options.durable.interaction ? { interaction: options.durable.interaction } : {}),
          }, {
            authorize: async (request, signal) => {
              try {
                await authorize(args(request.input), signal);
                return { allowed: true, decision: { ...decision, confirmation_approved: decision.confirmationRequired } };
              } catch (error) {
                signal.throwIfAborted();
                originalError = error;
                return { allowed: false, decision: { allowed: false, confirmationRequired: decision.confirmationRequired,
                  reason_code: 'authorization_denied' } };
              }
            },
            validateBeforeDispatch: () => {
              try { return options.durable!.validate(); } catch { return false; }
            },
            execute: async (request, signal) => {
              try {
                const result = await options.execute(args(request.input), signal);
                return { state: 'succeeded', result: result === undefined ? null : result,
                  side_effects: 'confirmed' };
              } catch (error) {
                originalError = error;
                // 声明 sideEffects=[] 不是接收方“未应用”的证据，普通 throw 不能安全重试。
                return { state: 'unknown', error_code: 'executor_unconfirmed', side_effects: 'unknown' };
              }
            },
          }, options.signal);
        } catch (error) {
          if (error instanceof ExecutionRecoveryRequiredError) {
            await this.publishResult(options.invocationId, options.signal);
            this.recordCommittedAudit({ traceId, skill: options.skill, targetKind: options.targetKind,
              targetName: options.targetName, decision, status: 'unknown', durationMs: Date.now() - startedAt,
              errorMessage: 'execution_recovery_required', policy });
            throw new SkillInvocationRecoveryRequiredError(error.invocationId);
          }
          throw error;
        }
        await this.publishResult(options.invocationId, options.signal);
        // 诊断失败不能改写已提交的 Execution 事实；重放仍返回原结果而不再派发。
        this.recordCommittedAudit({ traceId, skill: options.skill, targetKind: options.targetKind,
          targetName: options.targetName, decision, status: outcome.state === 'succeeded' ? 'succeeded'
            : outcome.error_code === 'authorization_denied' ? 'policy_denied' : 'failed',
          durationMs: Date.now() - startedAt, resultType: describeResult(outcome.result), policy });
        if (outcome.state === 'failed') throw originalError ?? new Error(`Execution 被拒绝或失败: ${outcome.error_code}`);
        return outcome.result;
      }

      await authorize(options.args, options.signal);

      try {
        const result = await options.execute(options.args, options.signal);
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
        if (options.signal?.aborted && policy.sideEffects.length > 0) {
          throw new SkillInvocationRecoveryRequiredError(options.invocationId ?? traceId);
        }
        throw error;
      }
    });
  }

  private recordCommittedAudit(options: Parameters<SkillInvocationGateway['recordAudit']>[0]): void {
    try { this.recordAudit(options); }
    catch {
      // 诊断不是执行事实 owner；sink 故障不能令调用者将已提交成功当作失败再派发。
      try { this._observability.logger('skill-invocation').warn('Execution 事实已保留，调用诊断写入失败', { trace_id: options.traceId }); }
      catch { /* journal/outbox 是可恢复事实，日志可重建且不能覆写该结果。 */ }
    }
  }

  private async publishResult(invocationId: string, signal?: AbortSignal): Promise<void> {
    const event = this._execution?.resultEvent(invocationId);
    if (!event || !this._resultOutbox) return;
    try { await this._resultOutbox.publish(event, signal); }
    catch {
      // 执行结果已提交；失败只保留 outbox，不重复执行。Synthesis 单独核验真实 Log 接纳。
      try { this._observability.logger('execution-results').warn('交互结果投递待重试', { invocation_id: invocationId }); }
      catch { /* outbox 保留可靠事实。 */ }
    }
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
    this._diagnostics.record({
      timestamp: record.timestamp,
      trace_id: options.traceId,
      provider_kind: options.skill.provider.kind,
      provider_id: options.skill.provider.id,
      skill_id: options.skill.id,
      target_kind: options.targetKind,
      target_name: options.targetName,
      status: options.status,
      duration_ms: options.durationMs,
      result_type: options.resultType,
      error_message: options.errorMessage,
      confirmation_required: options.decision.confirmationRequired,
    }, options.policy);
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
