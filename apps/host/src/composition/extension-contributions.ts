import { create, fromJson } from '@bufbuild/protobuf';
import { ValueSchema } from '@bufbuild/protobuf/wkt';
import type { JsonValue } from '@bufbuild/protobuf';
import Ajv2020 from 'ajv/dist/2020';
import { ExposeStepResponseSchema, ReadResourceResponseSchema, ExecutionResultState,
  type ExposeStepRequest, type ExposeStepResponse, type ReadResourceRequest, type ReadResourceResponse,
} from '@glimmer-cradle/contracts/glimmer/capabilities/v1/capabilities_pb';
import { ExposureController, ToolRegistry, SkillCatalog, ResourceRegistry, resourceContentFromValue, executionDigest,
} from '@glimmer-cradle/capabilities';
import type { Resource, ResourceContent, StepExposureRequest, StepSurface, ExposureGrant,
  ExecutionController, ExecutionResultOutbox, ExecutorPort } from '@glimmer-cradle/capabilities';
import type { Principal, PermissionGrant, PermissionRequest } from '@glimmer-cradle/platform';
import { PermissionBroker } from '../broker/permission-broker.js';

export interface HostResourceOptions {
  readonly host_id: string;
  readonly target_location: string;
  readonly permissions: PermissionBroker;
  readonly resources: ResourceRegistry;
  readonly execution: ExecutionController;
  readonly outbox: ExecutionResultOutbox;
  /** Host 配置/授权入口，而非 Worker、扩展 manifest 或模型自报 grant。缺省拒绝一切读取。 */
  readonly on_principal_registered?: (principal: Principal) => void;
}
export type ResourceReader = (arguments_: Readonly<Record<string, JsonValue>>, signal: AbortSignal) => Promise<unknown>;
export interface HostCapabilityServicePort {
  activatePrincipal(principalId: string, generation: string): void;
  revokePrincipal(principalId: string): void;
  exposeStep(request: ExposeStepRequest, principalId: string, signal: AbortSignal): Promise<ExposeStepResponse>;
  readResource(request: ReadResourceRequest, principalId: string, signal: AbortSignal): Promise<ReadResourceResponse>;
}
export class HostCapabilityRequestError extends Error {}

/** Host 接纳实际资源贡献；Registry 不缓存正文，Broker 授权不是定义 revision。
 * 当前只接 Resource 独立目录；Tool/Skill 的 Host 执行迁移尚未完成，不能冒充这些目录 ready。
 */
export class HostResourceContributions implements HostCapabilityServicePort {
  private readonly exposure: ExposureController;
  private readonly principals = new Map<string, Principal>();
  private readonly readers = new Map<string, { definition: Resource; reader: ResourceReader }>();
  private readonly steps = new Map<string, { request: StepExposureRequest; grants: Map<string, PermissionGrant>; calls: Map<string, string> }>();
  private readonly active = new Set<{ principal: string; grant?: string; resource: string; abort: AbortController }>();
  private readonly tasks = new Set<Promise<ReadResourceResponse>>();
  private readonly unsubscribe: () => void;
  private stopped = false;

  public constructor(private readonly options: HostResourceOptions) {
    for (const value of [options.host_id, options.target_location]) if (!value.trim()) throw new Error('Host Resource identity 无效');
    this.exposure = new ExposureController(new ToolRegistry(), new SkillCatalog(), options.resources);
    this.unsubscribe = options.permissions.onRevoked((principal, grant) => {
      for (const active of this.active) if (active.principal === principal && (grant === undefined || active.grant === grant)) active.abort.abort();
    });
  }
  public registerResource(definition: Resource, reader: ResourceReader): Resource {
    this.assertRunning();
    if (typeof reader !== 'function') throw new Error('Resource reader 未装配');
    const previous = this.readers.get(definition.id);
    if (previous?.definition.revision === definition.revision && previous.reader !== reader) throw new Error('同一 Resource revision 不能替换 reader');
    const registered = this.options.resources.register(definition);
    this.readers.set(registered.id, { definition: registered, reader });
    if (previous && previous.definition.revision !== registered.revision) this.abortResource(registered.id);
    return registered;
  }
  public revokeResource(resourceId: string, ownerId: string, revision?: string): boolean {
    const revoked = this.options.resources.revoke(resourceId, ownerId, revision);
    if (revoked) { this.readers.delete(resourceId); this.abortResource(resourceId); }
    return revoked;
  }
  public activatePrincipal(principalId: string, generation: string): void {
    this.assertRunning();
    const principal = this.options.permissions.registerPrincipal({ principal_id: principalId, host_id: this.options.host_id, generation, kind: 'service' });
    this.principals.set(principalId, principal);
    try { this.options.on_principal_registered?.(principal); }
    catch (error) { this.revokePrincipal(principalId); throw error; }
  }
  public revokePrincipal(principalId: string): void {
    this.principals.delete(principalId);
    for (const [key, step] of this.steps) if (step.request.principal_id === principalId) this.steps.delete(key);
    this.options.permissions.revokePrincipal(principalId);
  }
  public async exposeStep(wire: ExposeStepRequest, principalId: string, signal: AbortSignal): Promise<ExposeStepResponse> {
    signal.throwIfAborted(); this.assertRunning();
    const principal = this.principal(principalId);
    if (wire.call?.generation !== principal.generation || !wire.call.traceId) throw new HostCapabilityRequestError('Step 调用身份无效');
    const scope = this.scope(wire.scope);
    const request: StepExposureRequest = { principal_id: principalId, target_location: this.options.target_location,
      run_id: wire.runId, step: wire.step, scope, protocol_features: [...wire.protocolFeatures],
      budget: { max_definitions: Math.min(128, wire.maxDefinitions), max_definition_bytes: Math.min(64 * 1024, wire.maxDefinitionBytes),
        remaining_tool_calls: Math.min(32, wire.remainingToolCalls) } };
    const key = this.key(principalId, wire.runId, wire.step);
    const previous = this.steps.get(key);
    if (previous && executionDigest(previous.request) !== executionDigest(request)) throw new HostCapabilityRequestError('Step context 冲突');
    const grants = previous?.grants ?? new Map<string, PermissionGrant>();
    if (!previous) for (const resource of this.options.resources.list()) {
      if (this.readers.get(resource.id)?.definition !== resource) continue;
      const decision = this.options.permissions.authorize(this.permission(principal, resource));
      if (decision.allowed) grants.set(resource.id, decision.grant);
    }
    const surface = this.surface(request, grants);
    this.steps.set(key, { request, grants, calls: previous?.calls ?? new Map() });
    if (this.steps.size > 128) this.steps.delete(this.steps.keys().next().value!);
    return create(ExposeStepResponseSchema, { runId: surface.run_id, step: surface.step,
      resources: surface.resources.map(resource => ({ reference: resource.reference, name: resource.name,
        description: resource.description, inputSchema: fromJson(ValueSchema, resource.input_schema as JsonValue) })),
      usedDefinitionBytes: surface.used_definition_bytes, truncated: surface.truncated });
  }
  public readResource(wire: ReadResourceRequest, principalId: string, signal: AbortSignal): Promise<ReadResourceResponse> {
    const task = this.read(wire, principalId, signal).finally(() => this.tasks.delete(task));
    this.tasks.add(task); return task;
  }
  private async read(wire: ReadResourceRequest, principalId: string, signal: AbortSignal): Promise<ReadResourceResponse> {
    signal.throwIfAborted(); this.assertRunning();
    const principal = this.principal(principalId);
    const input = wire.request;
    if (!input || !input.reference || !input.call?.idempotencyKey || input.call.generation !== principal.generation || !input.sourceFactId || !input.callId
      || input.call.idempotencyKey !== `${input.runId}:${input.callId}` || input.name !== 'glimmer_read_resource') {
      throw new HostCapabilityRequestError('Resource 调用身份无效');
    }
    const step = this.steps.get(this.key(principalId, input.runId, input.step));
    const scope = this.scope(input.scope);
    if (!step || executionDigest(step.request.scope) !== executionDigest(scope)) throw new HostCapabilityRequestError('Resource 不在当次 Step');
    const reference = { id: input.reference.id, revision: input.reference.revision };
    const binding = this.readers.get(reference.id);
    const grant = step.grants.get(reference.id);
    const captured = this.surface(step.request, step.grants).resources.find(resource =>
      resource.reference.id === reference.id && resource.reference.revision === reference.revision);
    if (!binding || !captured || !grant) throw new HostCapabilityRequestError('Resource 未曝光或已撤销');
    const arguments_ = JSON.parse(JSON.stringify(input.arguments ?? {})) as Record<string, JsonValue>;
    if (!new Ajv2020({ strict: false }).validate(binding.definition.input_schema as object, arguments_)) {
      throw new HostCapabilityRequestError('Resource 参数无效');
    }
    freezeJson(arguments_);
    const digest = executionDigest({ reference, arguments: arguments_, source_fact_id: input.sourceFactId });
    const priorCall = step.calls.get(input.call.idempotencyKey);
    if (priorCall && priorCall !== digest) throw new HostCapabilityRequestError('Resource 调用摘要冲突');
    if (!priorCall && step.calls.size >= step.request.budget.remaining_tool_calls) throw new HostCapabilityRequestError('Resource Step 预算耗尽');
    step.calls.set(input.call.idempotencyKey, digest);
    const abort = new AbortController();
    const cancel = () => abort.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    const active = { principal: principalId, grant: grant.grant_id, resource: reference.id, abort };
    this.active.add(active);
    const current = () => !this.stopped && this.principals.get(principalId) === principal && this.options.permissions.isCurrent(grant)
      && this.options.resources.get(reference.id) === binding.definition && this.readers.get(reference.id) === binding;
    const executor: ExecutorPort = {
      authorize: async () => ({ allowed: current(), decision: { grant_id: grant.grant_id, permission_revision: grant.permission_revision } }),
      validateBeforeDispatch: current,
      execute: async (_request, receiverSignal) => ({ state: 'succeeded', side_effects: 'none',
        result: resourceContentFromValue(reference, await binding.reader(arguments_, receiverSignal)) }),
    };
    try {
      const invocation = await this.options.execution.execute({ invocation_id: input.call.idempotencyKey,
        idempotency_key: input.call.idempotencyKey, scope_id: scope.conversation_id,
        interaction: { conversation_id: scope.conversation_id, source_fact_id: input.sourceFactId },
        target: { executor_id: binding.definition.reader_id, capability_id: `resource:${reference.id}`, definition_revision: reference.revision },
        input: { principal_id: principalId, generation: principal.generation, grant_id: grant.grant_id,
          permission_revision: grant.permission_revision, operation: 'resource.read', arguments: arguments_, scope },
      }, executor, abort.signal);
      // 已确认执行可以入 journal，但权限撤销/切代后的结果不得继续暴露给当前调用。
      signal.throwIfAborted(); abort.signal.throwIfAborted();
      if (!current()) throw new HostCapabilityRequestError('Resource 授权已失效');
      const event = this.options.execution.resultEvent(invocation.invocation_id);
      if (!event || !await this.options.outbox.publish(event, abort.signal)) throw new Error('Resource 结果尚未持久接纳');
      signal.throwIfAborted(); abort.signal.throwIfAborted();
      if (!current()) throw new HostCapabilityRequestError('Resource 接纳后授权已失效');
      const result = invocation.result as ResourceContent;
      return create(ReadResourceResponseSchema, { result: { callId: input.callId, name: input.name,
        state: invocation.state === 'succeeded' ? ExecutionResultState.SUCCEEDED : ExecutionResultState.FAILED,
        error: invocation.error_code ?? '', resultEventId: event.event_id,
        ...(invocation.state === 'succeeded' ? { content: { case: 'resource' as const, value: {
          reference: result.reference, contentRevision: result.content_revision, contentUtf8: result.content_utf8, mediaType: result.media_type,
        } } } : {}),
      } });
    } finally { this.active.delete(active); signal.removeEventListener('abort', cancel); }
  }
  public async stop(): Promise<void> {
    this.stopped = true;
    for (const active of this.active) active.abort.abort();
    await Promise.allSettled([...this.tasks]);
    const failures: unknown[] = [];
    for (const owner of [this.options.execution, this.options.outbox]) {
      try { await owner.stop(); } catch (error) { failures.push(error); }
    }
    // 审计不可用仍必须撤销所有主体并解除监听；报告失败不能中断安全清理。
    for (const principalId of [...this.principals.keys()]) {
      try { this.revokePrincipal(principalId); } catch (error) { failures.push(error); }
    }
    this.steps.clear(); this.unsubscribe();
    if (failures.length) throw new AggregateError(failures, 'Host Resource 停止清理失败');
  }
  private permission(principal: Principal, resource: Resource): PermissionRequest {
    return { principal_id: principal.principal_id, host_id: principal.host_id, generation: principal.generation,
      permission: 'resource.read', resource_id: resource.id, resource_revision: resource.revision, target_location: this.options.target_location };
  }
  private surface(request: StepExposureRequest, grants: Map<string, PermissionGrant>): StepSurface {
    const exposureGrants: ExposureGrant[] = [...grants].filter(([id, grant]) => this.options.permissions.isCurrent(grant)
      && this.readers.get(id)?.definition === this.options.resources.get(id)).map(([id, grant]) => ({
      kind: 'resource', reference: { id, revision: grant.resource_revision }, principal_id: request.principal_id,
      target_location: this.options.target_location, permission_revision: grant.permission_revision, required_protocol_features: ['capability-read.v1'],
    }));
    return this.exposure.expose(request, exposureGrants);
  }
  private scope(wire: ExposeStepRequest['scope']): NonNullable<StepExposureRequest['scope']> {
    if (!wire || !wire.sourceProviderId || !wire.sceneId || !wire.conversationId || wire.userId !== undefined) {
      throw new HostCapabilityRequestError('Resource scope 未由 Host 接纳或用户未解析');
    }
    return { source_provider_id: wire.sourceProviderId, scene_id: wire.sceneId, conversation_id: wire.conversationId };
  }
  private principal(id: string): Principal {
    const value = this.principals.get(id);
    if (!value) throw new HostCapabilityRequestError('Host 主体未激活');
    return value;
  }
  private key(principal: string, run: string, step: number): string { return JSON.stringify([principal, run, step]); }
  private abortResource(id: string): void { for (const active of this.active) if (active.resource === id) active.abort.abort(); }
  private assertRunning(): void { if (this.stopped) throw new Error('Host Resource 已停止'); }
}

function freezeJson(value: unknown): void {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeJson(child); Object.freeze(value); }
}
