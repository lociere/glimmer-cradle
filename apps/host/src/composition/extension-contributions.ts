import { create, fromJson } from '@bufbuild/protobuf';
import { randomUUID } from 'node:crypto';
import { ValueSchema } from '@bufbuild/protobuf/wkt';
import type { JsonValue } from '@bufbuild/protobuf';
import Ajv2020 from 'ajv/dist/2020';
import { ExposeStepResponseSchema, ReadResourceResponseSchema, ExecutionResultState,
  CollectKnowledgeResourceResponseSchema, ValidateKnowledgeResourceResponseSchema,
  type CollectKnowledgeResourceRequest, type CollectKnowledgeResourceResponse,
  type ValidateKnowledgeResourceRequest, type ValidateKnowledgeResourceResponse,
  type ExposeStepRequest, type ExposeStepResponse, type ReadResourceRequest, type ReadResourceResponse,
} from '@glimmer-cradle/contracts/glimmer/capabilities/v1/capabilities_pb';
import { ExposureController, ToolRegistry, SkillCatalog, ResourceRegistry, resourceContentFromValue, executionDigest,
  isCapabilityDefinitionVisible,
} from '@glimmer-cradle/capabilities';
import type { Resource, ResourceContent, StepExposureRequest, StepSurface, ExposureGrant,
  ExecutionController, ExecutionResultOutbox, ExecutorPort } from '@glimmer-cradle/capabilities';
import type { Principal, PermissionGrant, PermissionRequest } from '@glimmer-cradle/platform';
import { PermissionBroker } from '../broker/permission-broker.js';
import { validateSecurityIdentity } from '@glimmer-cradle/platform';

export interface HostResourceOptions {
  readonly host_id: string;
  readonly target_location: string;
  readonly permissions: PermissionBroker;
  readonly resources: ResourceRegistry;
  readonly execution: ExecutionController;
  readonly outbox: ExecutionResultOutbox;
  readonly now?: () => number;
  /** Host 配置/授权入口，而非 Worker、扩展 manifest 或模型自报 grant。缺省拒绝一切读取。 */
  readonly on_principal_registered?: (principal: Principal) => void;
}
export type ResourceReader = (arguments_: Readonly<Record<string, JsonValue>>, signal: AbortSignal) => Promise<unknown>;
export interface HostCapabilityServicePort {
  activatePrincipal(principalId: string, generation: string): void;
  revokePrincipal(principalId: string): void;
  exposeStep(request: ExposeStepRequest, principalId: string, signal: AbortSignal): Promise<ExposeStepResponse>;
  readResource(request: ReadResourceRequest, principalId: string, signal: AbortSignal): Promise<ReadResourceResponse>;
  collectKnowledgeResource(request: CollectKnowledgeResourceRequest, principalId: string, signal: AbortSignal): Promise<CollectKnowledgeResourceResponse>;
  validateKnowledgeResource(request: ValidateKnowledgeResourceRequest, principalId: string, signal: AbortSignal): Promise<ValidateKnowledgeResourceResponse>;
}
export class HostCapabilityRequestError extends Error {}

/** Host IO 接纳政策，不拥有 Knowledge 正文/来源修订。调用方参数不能改写登记的读取目标。 */
export interface HostKnowledgeResourceAccess {
  readonly source_id: string;
  readonly reference: { readonly id: string; readonly revision: string };
  readonly scope: StepExposureRequest['scope'];
  readonly arguments: Readonly<Record<string, JsonValue>>;
  readonly max_age_ms: number;
}
type KnowledgeAdmission = { readonly policy: HostKnowledgeResourceAccess; readonly principal: Principal; attempt: number };
type KnowledgeProof = { readonly admission: KnowledgeAdmission; readonly binding: { definition: Resource; reader: ResourceReader };
  readonly read_grant: PermissionGrant; readonly ingest_grant: PermissionGrant;
  readonly content_revision: string; readonly media_type: string; readonly collected_at_ms: number; readonly expires_at_ms: number };

/** Host 接纳实际资源贡献；Registry 不缓存正文，Broker 授权不是定义 revision。
 * 当前只接 Resource 独立目录；Tool/Skill 的 Host 执行迁移尚未完成，不能冒充这些目录 ready。
 */
export class HostResourceContributions implements HostCapabilityServicePort {
  private readonly exposure: ExposureController;
  private readonly principals = new Map<string, Principal>();
  private readonly readers = new Map<string, { definition: Resource; reader: ResourceReader }>();
  private readonly steps = new Map<string, { request: StepExposureRequest; grants: Map<string, PermissionGrant>; calls: Map<string, string> }>();
  private readonly active = new Set<{ principal: string; grant?: string; ingest_grant?: string; source?: KnowledgeAdmission; resource: string; abort: AbortController }>();
  private readonly tasks = new Set<Promise<unknown>>();
  private readonly knowledgeAdmissions = new Map<string, KnowledgeAdmission>();
  private readonly knowledgeProofs = new Map<string, KnowledgeProof>();
  private lastCollectionTime = 0;
  private readonly unsubscribe: () => void;
  private stopped = false;

  public constructor(private readonly options: HostResourceOptions) {
    for (const value of [options.host_id, options.target_location]) if (!value.trim()) throw new Error('Host Resource identity 无效');
    this.exposure = new ExposureController(new ToolRegistry(), new SkillCatalog(), options.resources);
    this.unsubscribe = options.permissions.onRevoked((principal, grant) => {
      for (const active of this.active) if (active.principal === principal && (grant === undefined || active.grant === grant || active.ingest_grant === grant)) active.abort.abort();
      for (const [id, proof] of this.knowledgeProofs) if (proof.admission.principal.principal_id === principal
        && (grant === undefined || proof.read_grant.grant_id === grant || proof.ingest_grant.grant_id === grant)) this.knowledgeProofs.delete(id);
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
  public invalidateResourceContent(resourceId: string, ownerId: string): void {
    this.assertRunning(); const resource = this.options.resources.get(resourceId);
    if (!resource || resource.owner_id !== ownerId) throw new HostCapabilityRequestError('Resource 内容失效 owner 不匹配');
    // 正文更新不必改变目录定义；资源 owner 通知独立失效，取消等待并撤销已有采集证明。
    this.abortResource(resourceId);
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
    for (const [key, source] of this.knowledgeAdmissions) if (source.principal.principal_id === principalId) this.knowledgeAdmissions.delete(key);
    for (const [key, proof] of this.knowledgeProofs) if (proof.admission.principal.principal_id === principalId) this.knowledgeProofs.delete(key);
    this.options.permissions.revokePrincipal(principalId);
  }
  public registerKnowledgeAccess(principalId: string, input: HostKnowledgeResourceAccess): void {
    this.assertRunning(); const principal = this.principal(principalId);
    for (const id of [input.source_id, input.reference.id, input.reference.revision]) validateSecurityIdentity(id);
    if (input.scope) for (const id of [input.scope.source_provider_id, input.scope.scene_id, input.scope.conversation_id]) validateSecurityIdentity(id);
    if (input.scope?.user_id !== undefined || !Number.isSafeInteger(input.max_age_ms) || input.max_age_ms < 1 || input.max_age_ms > 86_400_000) {
      throw new HostCapabilityRequestError('Knowledge IO 接纳政策无效');
    }
    const binding = this.readers.get(input.reference.id);
    if (!binding || binding.definition.revision !== input.reference.revision || !isCapabilityDefinitionVisible(binding.definition, input.scope)) {
      throw new HostCapabilityRequestError('Knowledge Resource 不可见');
    }
    const arguments_ = JSON.parse(JSON.stringify(input.arguments)) as Record<string, JsonValue>;
    if (Buffer.byteLength(JSON.stringify(arguments_), 'utf8') > 32 * 1024
      || !new Ajv2020({ strict: false }).validate(binding.definition.input_schema as object, arguments_)) throw new HostCapabilityRequestError('Knowledge Resource 参数无效');
    const key = JSON.stringify([principalId, input.source_id]);
    if (this.knowledgeAdmissions.has(key) || this.knowledgeAdmissions.size >= 1024) throw new HostCapabilityRequestError('Knowledge IO 接纳身份重复或预算耗尽');
    const policy: HostKnowledgeResourceAccess = { source_id: input.source_id, reference: { ...input.reference },
      scope: input.scope ? { source_provider_id: input.scope.source_provider_id, scene_id: input.scope.scene_id, conversation_id: input.scope.conversation_id } : undefined,
      arguments: arguments_, max_age_ms: input.max_age_ms };
    freezeJson(policy); this.knowledgeAdmissions.set(key, { policy, principal, attempt: 0 });
  }
  public revokeKnowledgeAccess(principalId: string, sourceId: string): void {
    const key = JSON.stringify([principalId, sourceId]);
    const source = this.knowledgeAdmissions.get(key); this.knowledgeAdmissions.delete(key);
    for (const [id, proof] of this.knowledgeProofs) if (proof.admission === source) this.knowledgeProofs.delete(id);
    if (source) this.abortResource(source.policy.reference.id);
  }
  public collectKnowledgeResource(wire: CollectKnowledgeResourceRequest, principalId: string, signal: AbortSignal): Promise<CollectKnowledgeResourceResponse> {
    const task = this.collect(wire, principalId, signal).finally(() => this.tasks.delete(task));
    this.tasks.add(task); return task;
  }
  private async collect(wire: CollectKnowledgeResourceRequest, principalId: string, signal: AbortSignal): Promise<CollectKnowledgeResourceResponse> {
    signal.throwIfAborted(); this.assertRunning(); const principal = this.principal(principalId);
    if (wire.call?.generation !== principal.generation || !wire.call.traceId) throw new HostCapabilityRequestError('Knowledge 采集世代无效');
    const scope = wire.scope ? this.scope(wire.scope) : undefined;
    const source = this.knowledgeAdmissions.get(JSON.stringify([principalId, wire.sourceId]));
    if (!source || executionDigest(source.policy.scope ?? null) !== executionDigest(scope ?? null)
      || wire.reference?.id !== source.policy.reference.id || wire.reference.revision !== source.policy.reference.revision) throw new HostCapabilityRequestError('Knowledge 未显式接纳或 scope 冲突');
    const binding = this.readers.get(source.policy.reference.id);
    if (!binding || binding.definition.revision !== source.policy.reference.revision || !isCapabilityDefinitionVisible(binding.definition, scope)) throw new HostCapabilityRequestError('Knowledge Resource 不可见');
    const read = this.options.permissions.authorize(this.permission(principal, binding.definition));
    const ingest = this.options.permissions.authorize({ ...this.permission(principal, binding.definition), permission: 'knowledge.ingest' });
    if (!read.allowed || !ingest.allowed) throw new HostCapabilityRequestError('Knowledge 采集授权缺失');
    if (this.active.size >= 128 || [...this.active].filter(value => value.source === source).length >= 2) throw new HostCapabilityRequestError('Knowledge 采集并发预算耗尽');
    const attempt = ++source.attempt;
    for (const [id, proof] of this.knowledgeProofs) if (proof.admission === source) this.knowledgeProofs.delete(id);
    const abort = new AbortController(), cancel = () => abort.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    const active = { principal: principalId, grant: read.grant.grant_id, ingest_grant: ingest.grant.grant_id, source, resource: binding.definition.id, abort };
    this.active.add(active);
    try {
      const content = resourceContentFromValue(source.policy.reference, await binding.reader(source.policy.arguments, abort.signal));
      signal.throwIfAborted(); abort.signal.throwIfAborted();
      const collectedAt = this.collectionTime();
      const expiresAt = Math.min(read.grant.expires_at_ms, ingest.grant.expires_at_ms, collectedAt + source.policy.max_age_ms);
      const proof: KnowledgeProof = { admission: source, binding, read_grant: read.grant, ingest_grant: ingest.grant,
        content_revision: content.content_revision, media_type: content.media_type, collected_at_ms: collectedAt, expires_at_ms: expiresAt };
      if (source.attempt !== attempt || !this.proofCurrent(proof)) throw new HostCapabilityRequestError('Knowledge 采集期间来源或授权已失效');
      const id = randomUUID(); this.knowledgeProofs.set(id, proof);
      return create(CollectKnowledgeResourceResponseSchema, { content: { reference: content.reference, contentRevision: content.content_revision,
        mediaType: content.media_type, contentUtf8: content.content_utf8 }, access: { accessId: id, sourceId: source.policy.source_id,
        principalId, permissionRevision: ingest.grant.permission_revision, collectedAtMs: BigInt(collectedAt), expiresAtMs: BigInt(expiresAt) } });
    } finally { this.active.delete(active); signal.removeEventListener('abort', cancel); }
  }
  public async validateKnowledgeResource(wire: ValidateKnowledgeResourceRequest, principalId: string, signal: AbortSignal): Promise<ValidateKnowledgeResourceResponse> {
    signal.throwIfAborted(); this.assertRunning(); const principal = this.principal(principalId);
    if (wire.call?.generation !== principal.generation || !wire.call.traceId) throw new HostCapabilityRequestError('Knowledge 复验世代无效');
    const scope = wire.scope ? this.scope(wire.scope) : undefined, access = wire.access, proof = access && this.knowledgeProofs.get(access.accessId);
    const current = !!proof && !!access && proof.admission.principal === principal && proof.admission.policy.source_id === access.sourceId
      && access.principalId === principalId && access.permissionRevision === proof.ingest_grant.permission_revision
      && access.collectedAtMs === BigInt(proof.collected_at_ms) && access.expiresAtMs === BigInt(proof.expires_at_ms)
      && executionDigest(scope ?? null) === executionDigest(proof.admission.policy.scope ?? null)
      && wire.reference?.id === proof.admission.policy.reference.id && wire.reference.revision === proof.admission.policy.reference.revision
      && wire.contentRevision === proof.content_revision && wire.mediaType === proof.media_type && this.proofCurrent(proof);
    if (proof && !this.proofCurrent(proof)) this.knowledgeProofs.delete(access!.accessId);
    return create(ValidateKnowledgeResourceResponseSchema, { current });
  }
  private proofCurrent(proof: KnowledgeProof): boolean {
    const source = proof.admission, key = JSON.stringify([source.principal.principal_id, source.policy.source_id]);
    return !this.stopped && this.knowledgeAdmissions.get(key) === source && this.principals.get(source.principal.principal_id) === source.principal
      && this.readers.get(proof.binding.definition.id) === proof.binding && this.options.resources.get(proof.binding.definition.id) === proof.binding.definition
      && this.options.permissions.isCurrent(proof.read_grant) && this.options.permissions.isCurrent(proof.ingest_grant)
      && this.collectionTime() < proof.expires_at_ms;
  }
  private collectionTime(): number {
    const now = (this.options.now ?? Date.now)();
    if (!Number.isSafeInteger(now) || now < 0) throw new HostCapabilityRequestError('Knowledge 时钟无效');
    this.lastCollectionTime = Math.max(now, this.lastCollectionTime); return this.lastCollectionTime;
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
    this.knowledgeAdmissions.clear(); this.knowledgeProofs.clear();
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
  private abortResource(id: string): void {
    for (const active of this.active) if (active.resource === id) active.abort.abort();
    for (const [key, proof] of this.knowledgeProofs) if (proof.binding.definition.id === id) this.knowledgeProofs.delete(key);
  }
  private assertRunning(): void { if (this.stopped) throw new Error('Host Resource 已停止'); }
}

function freezeJson(value: unknown): void {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeJson(child); Object.freeze(value); }
}
