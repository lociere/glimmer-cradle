import { executionDigest, ExecutionConflictError } from '@glimmer-cradle/capabilities';
import type { CapabilityDefinition, CapabilityKind, ExposureGrant, StepExposureRequest, StepSurface } from '@glimmer-cradle/capabilities';
import type { CapabilityCatalogPort } from '../../ports/skill-plane.port';
import { NativeCapabilityRequestError } from '../../ports/native-capability-service.port';
import type { NativeCapabilityServicePort, NativeToolInvocation, NativeToolResult } from '../../ports/native-capability-service.port';
import { SkillInvocationGateway } from '../skill-plane/skill-invocation-gateway';
import { SkillPolicyEngine } from '../skill-plane/skill-policy-engine';

/** 原生服务接入装配；当前策略源仍是现行 App Policy，随阶段 9/12 迁权限 broker/Host。 */
export class NativeCapabilityAppService implements NativeCapabilityServicePort {
  private readonly steps = new Map<string, { request: StepExposureRequest; surface: StepSurface; calls: Map<string, string> }>();
  public constructor(private readonly catalog: CapabilityCatalogPort, private readonly gateway: SkillInvocationGateway,
    private readonly policy: SkillPolicyEngine, private readonly location: string) {}

  public exposeStep(input: StepExposureRequest): StepSurface {
    if (!input.scope) throw new NativeCapabilityRequestError('Native Step 缺少 scope');
    // 当前接入尚无 Host-owned 平台用户解析；监督 Worker 的自报字段不是用户授权事实。
    if (input.user_id !== undefined || input.scope.user_id !== undefined) throw new NativeCapabilityRequestError('Native Step 用户身份尚未由 Host 解析');
    const request = { ...input, target_location: this.location, budget: {
      max_definitions: Math.min(input.budget.max_definitions, 128),
      max_definition_bytes: Math.min(input.budget.max_definition_bytes, 64 * 1024),
      remaining_tool_calls: Math.min(input.budget.remaining_tool_calls, 32),
    } };
    const snapshot = JSON.parse(JSON.stringify(request)) as StepExposureRequest;
    const surface = this.catalog.exposeStep(snapshot, this.grants(snapshot));
    const key = this.key(request.principal_id, request.run_id, request.step);
    const previous = this.steps.get(key);
    if (previous && executionDigest(previous.request) !== executionDigest(request)) throw new NativeCapabilityRequestError('Step context 不能替换');
    this.steps.set(key, { request: snapshot, surface, calls: previous?.calls ?? new Map() });
    // 曝光是短寿命投影；被回收的旧 Step 不能拿旧快照派发，持久恢复仍由 journal 拥有。
    if (this.steps.size > 128) this.steps.delete(this.steps.keys().next().value!);
    return surface;
  }

  public async invokeTool(request: NativeToolInvocation, traceId: string, signal: AbortSignal): Promise<NativeToolResult> {
    signal.throwIfAborted();
    const step = this.steps.get(this.key(request.principal_id, request.run_id, request.step));
    if (!step || executionDigest(step.request.scope) !== executionDigest(request.scope)) throw new NativeCapabilityRequestError('Step 未曝光或 scope 冲突');
    const matches = (surface: StepSurface) => surface.tools.some(tool => tool.name === request.name
      && tool.reference.id === request.reference.id && tool.reference.revision === request.reference.revision);
    if (!matches(step.surface) || !matches(this.catalog.exposeStep(step.request, this.grants(step.request)))) {
      throw new NativeCapabilityRequestError('Tool 未曝光、已撤销或定义版本变更');
    }
    if (request.invocation_id !== `${request.run_id}:${request.call_id}` || !request.source_fact_id) throw new NativeCapabilityRequestError('Tool invocation identity 无效');
    const digest = executionDigest({ reference: request.reference, arguments: request.arguments, source_fact_id: request.source_fact_id });
    const previous = step.calls.get(request.invocation_id);
    if (previous && previous !== digest) throw new NativeCapabilityRequestError('Tool invocation 内容冲突');
    if (!previous && step.calls.size >= step.request.budget.remaining_tool_calls) throw new NativeCapabilityRequestError('Step Tool budget 耗尽');
    step.calls.set(request.invocation_id, digest);
    // 仅解析当次真实注册且曝光过的接入引用，不从模型名称推断 provider/权限。
    const [group, name] = JSON.parse(request.reference.id) as [string, string];
    let result: unknown;
    try {
      result = await this.gateway.invoke({ skillId: group, toolName: name, args: request.arguments,
        conversation: request.scope, invocationId: request.invocation_id, sourceFactId: request.source_fact_id, traceId, signal });
    } catch (error) {
      const event = this.gateway.resultEvent(request.invocation_id);
      // 只投影已经提交的已知失败；摘要冲突/未知派发/普通异常不能伪造 failed。
      if (error instanceof ExecutionConflictError || event?.invocation.state !== 'failed') throw error;
      return { call_id: request.call_id, name: request.name, state: 'failed', error: event.invocation.error_code ?? 'execution_failed', result_event_id: event.event_id };
    }
    const event = this.gateway.resultEventId(request.invocation_id);
    if (!event) throw new Error('Native Tool 缺少 durable result event');
    return { call_id: request.call_id, name: request.name, state: 'succeeded', result, result_event_id: event };
  }

  public revokePrincipal(principalId: string): void {
    for (const [key, step] of this.steps) if (step.request.principal_id === principalId) this.steps.delete(key);
  }

  private key(principal: string, run: string, step: number): string { return JSON.stringify([principal, run, step]); }
  private grants(request: StepExposureRequest): ExposureGrant[] {
    const grants: ExposureGrant[] = [];
    const grant = (kind: CapabilityKind, definition: CapabilityDefinition | undefined): void => {
      if (definition) grants.push({ kind, reference: { id: definition.id, revision: definition.revision },
        principal_id: request.principal_id, ...(request.user_id === undefined ? {} : { user_id: request.user_id }),
        target_location: this.location, permission_revision: definition.revision,
        required_protocol_features: kind === 'tool' ? ['tool-call.v1'] : [] });
    };
    const inlineMethods = new Set(this.catalog.listReadyMethods(request.scope).map(item => item.reference.skill_id));
    for (const entry of this.catalog.listCatalogEntries()) {
      const source = this.catalog.findById(entry.id)?.skill;
      if (!source || !this.policy.evaluate(source).allowed) continue;
      for (const tool of source.tools) {
        const definition = this.catalog.findTool(source.id, tool.name);
        if (definition && this.catalog.isProviderReady(definition.owner_id) && this.policy.evaluate(source, tool.policy ?? source.policy).allowed) grant('tool', definition);
      }
      for (const item of source.resources ?? []) {
        const definition = this.catalog.findResource(source.id, item.id);
        if (definition && this.catalog.isProviderReady(definition.owner_id)) grant('resource', definition);
      }
      for (const item of source.prompts ?? []) {
        const definition = this.catalog.findMethod(source.id, item.id);
        if (definition && (this.catalog.isProviderReady(definition.owner_id) || inlineMethods.has(definition.id))) grant('skill', definition);
      }
    }
    return grants;
  }
}
