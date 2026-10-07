import { clone, create, fromJson } from '@bufbuild/protobuf';
import { createHash, randomUUID } from 'node:crypto';
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
import type { CollectKnowledgeSourceResponse, KnowledgeResourceSourceState, RegisterKnowledgeResourceSourceRequest } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { RegisterKnowledgeResourceSourceRequestSchema } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { CognitionClient } from '../adapters/protocol/cognition-client.js';

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
/** 内部装配参数；唯一可存储审批 Document 是 HostConfig，不复制来源声明。 */
export interface HostKnowledgeApproval {
  readonly source_id: string;
  readonly source_revision: number;
  readonly declaration_digest: string;
  readonly arguments: HostKnowledgeResourceAccess['arguments'];
  readonly max_age_ms: number;
  readonly expires_at_ms: number;
}
export type HostResourceChange = Readonly<{ kind: 'content_changed' | 'definition_changed' | 'removed';
  reference: Readonly<{ id: string; revision: string }> } | { kind: 'stopped' }>;
export interface HostKnowledgeSnapshot {
  readonly status: 'idle' | 'refreshing' | 'degraded' | 'stopped';
  /** accepted 仅指最后真实 receipt，不宣称此刻所有材料仍 current；Context 独立 live 复验。 */
  readonly sources: readonly Readonly<{ source_id: string; status: 'waiting' | 'accepted' | 'refreshing' | 'blocked' | 'failed';
    last_entry_revision: number | null; error_code: string | null }>[];
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
  private readonly resourceListeners = new Set<(change: HostResourceChange) => void>();
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
    if (previous?.definition === registered) return registered;
    this.readers.set(registered.id, { definition: registered, reader });
    if (previous && previous.definition.revision !== registered.revision) {
      this.abortResource(registered.id);
      this.publishResourceChange({ kind: 'definition_changed', reference: { id: registered.id, revision: registered.revision } });
    }
    return registered;
  }
  public revokeResource(resourceId: string, ownerId: string, revision?: string): boolean {
    const previous = this.options.resources.get(resourceId);
    const revoked = this.options.resources.revoke(resourceId, ownerId, revision);
    if (revoked) {
      this.readers.delete(resourceId); this.abortResource(resourceId);
      this.publishResourceChange({ kind: 'removed', reference: { id: resourceId, revision: previous!.revision } });
    }
    return revoked;
  }
  public invalidateResourceContent(resourceId: string, ownerId: string): void {
    this.assertRunning(); const resource = this.options.resources.get(resourceId);
    if (!resource || resource.owner_id !== ownerId) throw new HostCapabilityRequestError('Resource 内容失效 owner 不匹配');
    // 正文更新不必改变目录定义；资源 owner 通知独立失效，取消等待并撤销已有采集证明。
    this.abortResource(resourceId);
    this.publishResourceChange({ kind: 'content_changed', reference: { id: resourceId, revision: resource.revision } });
  }
  public onResourceChanged(listener: (change: HostResourceChange) => void): () => void {
    this.assertRunning();
    if (typeof listener !== 'function' || this.resourceListeners.size >= 128) throw new HostCapabilityRequestError('Resource 订阅预算耗尽');
    this.resourceListeners.add(listener); return () => this.resourceListeners.delete(listener);
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
  public approveKnowledgeSource(principalId: string, state: KnowledgeResourceSourceState, approval: HostKnowledgeApproval): {
    reference: Readonly<{ id: string; revision: string }>; revoke: () => void; current: () => boolean;
  } {
    validateHostKnowledgeApprovals([approval]);
    this.assertRunning(); const principal = this.principal(principalId), source = state.source;
    if (!source?.reference || source.enabled !== true || source.sourceId !== approval.source_id
      || state.sourceRevision !== BigInt(approval.source_revision) || state.declarationDigest !== approval.declaration_digest
      || source.scope?.userId !== undefined || source.priority < 1n || source.priority > BigInt(Number.MAX_SAFE_INTEGER)) throw new HostCapabilityRequestError('Knowledge 来源与审批冲突');
    for (const value of [source.sourceId, source.reference.id, source.reference.revision]) validateSecurityIdentity(value);
    if (source.scope) for (const value of [source.scope.sourceProviderId, source.scope.sceneId, source.scope.conversationId]) validateSecurityIdentity(value);
    const digest = createHash('sha256').update(JSON.stringify(['knowledge-resource-source.v1', source.sourceId,
      source.reference.id, source.reference.revision, source.scope ? [source.scope.sourceProviderId, source.scope.sceneId, source.scope.conversationId]
        : [null, null, null], Number(source.priority), source.enabled]), 'utf8').digest('hex');
    if (digest !== state.declarationDigest) throw new HostCapabilityRequestError('Knowledge 来源摘要无效');
    const request: PermissionRequest = { principal_id: principal.principal_id, host_id: principal.host_id,
      generation: principal.generation, permission: 'resource.read', resource_id: source.reference.id,
      resource_revision: source.reference.revision, target_location: this.options.target_location };
    const grants: PermissionGrant[] = [];
    const sourceId = source.sourceId;
    const revoke = () => {
      this.revokeKnowledgeAccess(principalId, sourceId);
      // 即使一次审计失败，也必须撤销另一个 grant；Broker 先删除再报告审计错误。
      let failure: unknown;
      for (const grant of grants) try { this.options.permissions.revokeGrant(grant.grant_id); } catch (error) { failure ??= error; }
      if (failure) throw failure;
    };
    try {
      this.registerKnowledgeAccess(principalId, { source_id: source.sourceId, reference: source.reference,
        scope: source.scope ? { source_provider_id: source.scope.sourceProviderId, scene_id: source.scope.sceneId,
          conversation_id: source.scope.conversationId } : undefined, arguments: approval.arguments, max_age_ms: approval.max_age_ms });
      grants.push(this.options.permissions.grant(request, approval.expires_at_ms));
      grants.push(this.options.permissions.grant({ ...request, permission: 'knowledge.ingest' }, approval.expires_at_ms));
      const admission = this.knowledgeAdmissions.get(JSON.stringify([principalId, sourceId]));
      const binding = this.readers.get(request.resource_id);
      return { reference: Object.freeze({ id: request.resource_id, revision: request.resource_revision }), revoke,
        current: () => !this.stopped && this.knowledgeAdmissions.get(JSON.stringify([principalId, sourceId])) === admission
          && this.readers.get(request.resource_id)?.definition === binding?.definition
          && this.readers.get(request.resource_id)?.reader === binding?.reader
          && this.options.resources.get(request.resource_id) === binding?.definition
          && grants.every(grant => this.options.permissions.isCurrent(grant)) };
    } catch (error) { revoke(); throw error; }
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
    const failures: unknown[] = [];
    try { this.publishResourceChange({ kind: 'stopped' }); } catch (error) { failures.push(error); }
    this.resourceListeners.clear();
    await Promise.allSettled([...this.tasks]);
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
  private publishResourceChange(change: HostResourceChange): void {
    if ('reference' in change) Object.freeze(change.reference);
    Object.freeze(change);
    const failures: unknown[] = [];
    // 失效先于通知；单个观察者错误不能阻断其他 owner 撤权或重新采集。
    for (const listener of [...this.resourceListeners]) try { listener(change); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Resource 失效通知失败');
  }
  private assertRunning(): void { if (this.stopped) throw new Error('Host Resource 已停止'); }
}

/** 当前世代的可信 App controller；来源留在 Cognition，IO 审批留在 Host。 */
export class HostKnowledgeController {
  private readonly approvals: ReadonlyMap<string, HostKnowledgeApproval>;
  private readonly admissions = new Map<string, ReturnType<HostResourceContributions['approveKnowledgeSource']>>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly aborts = new Map<string, Set<AbortController>>();
  private readonly sourceStates = new Map<string, HostKnowledgeSnapshot['sources'][number]>();
  private readonly refreshQueue = new Map<string, { admission: ReturnType<HostResourceContributions['approveKnowledgeSource']>; ticket: object }>();
  private readonly refreshTickets = new Map<string, object>();
  private readonly unsubscribeResource: () => void;
  private refreshTask?: Promise<void>;
  private stopped = false;
  private starting?: Promise<void>;
  private stopping?: Promise<void>;
  public constructor(private readonly resources: HostResourceContributions, private readonly cognition: CognitionClient,
    private readonly generation: string, approvals: readonly HostKnowledgeApproval[]) {
    if (!generation.trim()) throw new HostCapabilityRequestError('Knowledge 装配无效');
    validateHostKnowledgeApprovals(approvals);
    const policies = new Map<string, HostKnowledgeApproval>();
    for (const value of approvals) {
      const policy = { ...value, arguments: JSON.parse(JSON.stringify(value.arguments)) };
      freezeJson(policy); policies.set(value.source_id, policy);
      this.sourceStates.set(value.source_id, { source_id: value.source_id, status: 'waiting', last_entry_revision: null, error_code: null });
    }
    this.approvals = policies;
    this.unsubscribeResource = resources.onResourceChanged(change => this.resourceChanged(change));
  }
  public get snapshot(): HostKnowledgeSnapshot {
    const sources = [...this.sourceStates.values()].map(value => Object.freeze({ ...value })).sort((a, b) => a.source_id.localeCompare(b.source_id));
    return Object.freeze({ status: this.stopped ? 'stopped' : sources.some(value => ['blocked', 'failed'].includes(value.status))
      ? 'degraded' : sources.some(value => value.status === 'refreshing') ? 'refreshing' : 'idle', sources: Object.freeze(sources) });
  }
  public start(): Promise<void> {
    if (this.stopped) return Promise.reject(new HostCapabilityRequestError('Knowledge controller 已停止'));
    return this.starting ??= (async () => {
      for (const sourceId of this.approvals.keys()) await this.collect(sourceId);
    })();
  }
  public getSource(sourceId: string) {
    return this.run(sourceId, signal => this.cognition.getKnowledgeSource(sourceId, signal));
  }
  public registerSource(request: RegisterKnowledgeResourceSourceRequest) {
    const captured = clone(RegisterKnowledgeResourceSourceRequestSchema, request);
    const sourceId = captured.source?.sourceId ?? '';
    // 先撤销正在使用的 IO/证明，再等待来源 CAS；丢失响应保持拒绝而非复活旧审批。
    this.revoke(sourceId);
    this.markSource(sourceId, 'blocked', 'knowledge_source_changed');
    return this.run(sourceId, signal => this.cognition.registerKnowledgeSource(captured, signal));
  }
  public collect(sourceId: string) {
    this.revoke(sourceId);
    this.markSource(sourceId, 'refreshing', null);
    const task = this.run(sourceId, async signal => {
      const approval = this.approvals.get(sourceId);
      if (!approval) throw new HostCapabilityRequestError('Knowledge 未显式审批');
      const response = await this.cognition.getKnowledgeSource(sourceId, signal);
      signal.throwIfAborted();
      if (this.stopped || !response.state) throw new HostCapabilityRequestError('Knowledge 来源不存在或已停止');
      const admitted = this.resources.approveKnowledgeSource(`cognition:${this.generation}`, response.state, approval);
      this.admissions.set(sourceId, admitted);
      try {
        const receipt = await this.cognition.collectKnowledgeSource(sourceId, BigInt(approval.source_revision), signal);
        signal.throwIfAborted();
        this.acceptReceipt(sourceId, receipt, admitted);
        return receipt;
      } catch (error) {
        if (this.admissions.get(sourceId) === admitted) { this.admissions.delete(sourceId); admitted.revoke(); }
        throw error;
      }
    });
    return task.catch(error => { if (!this.stopped) this.markSource(sourceId, 'failed', 'knowledge_collect_failed'); throw error; });
  }
  public stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.unsubscribeResource(); this.refreshQueue.clear(); this.refreshTickets.clear();
    this.stopping = (async () => {
      const failures: unknown[] = [];
      for (const sourceId of new Set([...this.aborts.keys(), ...this.admissions.keys()])) {
        try { this.revoke(sourceId); } catch (error) { failures.push(error); }
      }
      await Promise.allSettled([...this.pending.values()]);
      await this.refreshTask;
      this.cognition.close();
      if (failures.length) throw new AggregateError(failures, 'Knowledge 撤销审计失败');
    })();
    return this.stopping;
  }
  private revoke(sourceId: string): void {
    this.refreshQueue.delete(sourceId); this.refreshTickets.delete(sourceId);
    for (const abort of this.aborts.get(sourceId) ?? []) abort.abort();
    const admitted = this.admissions.get(sourceId); this.admissions.delete(sourceId); admitted?.revoke();
  }
  private markSource(sourceId: string, status: HostKnowledgeSnapshot['sources'][number]['status'], errorCode: string | null, revision?: number): void {
    const prior = this.sourceStates.get(sourceId);
    if (prior) this.sourceStates.set(sourceId, { ...prior, status, error_code: errorCode, last_entry_revision: revision ?? prior.last_entry_revision });
  }
  private acceptReceipt(sourceId: string, receipt: CollectKnowledgeSourceResponse,
    admitted: ReturnType<HostResourceContributions['approveKnowledgeSource']>): void {
    if (!admitted.current() || receipt.sourceId !== sourceId || receipt.sourceRevision !== BigInt(this.approvals.get(sourceId)!.source_revision)
      || receipt.entryId !== `resource:${sourceId}` || receipt.entryRevision < 1n
      || receipt.entryRevision > BigInt(Number.MAX_SAFE_INTEGER) || !/^[a-f0-9]{64}$/.test(receipt.contentDigest)) {
      throw new HostCapabilityRequestError('Knowledge 采集确认无效或已撤销');
    }
    this.markSource(sourceId, 'accepted', null, Number(receipt.entryRevision));
  }
  private resourceChanged(change: HostResourceChange): void {
    if (this.stopped) return;
    const failures: unknown[] = [];
    for (const [sourceId, admission] of [...this.admissions]) {
      if (change.kind !== 'stopped' && admission.reference.id !== change.reference.id) continue;
      let current = false;
      try { current = change.kind === 'content_changed' && admission.reference.revision === change.reference.revision && admission.current(); }
      catch (error) { failures.push(error); }
      if (!current) {
        try { this.revoke(sourceId); } catch (error) { failures.push(error); }
        this.markSource(sourceId, 'blocked', 'knowledge_resource_or_access_changed'); continue;
      }
      for (const abort of this.aborts.get(sourceId) ?? []) abort.abort();
      const ticket = {};
      this.refreshTickets.set(sourceId, ticket); this.refreshQueue.set(sourceId, { admission, ticket });
      this.markSource(sourceId, 'refreshing', null);
    }
    this.scheduleRefresh();
    if (failures.length) throw new AggregateError(failures, 'Knowledge 失效撤销失败');
  }
  private scheduleRefresh(): void {
    if (this.stopped || this.refreshTask || !this.refreshQueue.size) return;
    // 一个 pump、每来源一个最新 ticket；通知风暴不制造无界 Promise/计时器或重授授权。
    this.refreshTask = Promise.resolve().then(async () => {
      while (!this.stopped && this.refreshQueue.size) {
        const [sourceId, target] = this.refreshQueue.entries().next().value!;
        this.refreshQueue.delete(sourceId);
        try {
          await this.run(sourceId, async signal => {
            if (this.admissions.get(sourceId) !== target.admission || this.refreshTickets.get(sourceId) !== target.ticket) return;
            if (!target.admission.current()) throw new HostCapabilityRequestError('Knowledge 原授权失效');
            const state = (await this.cognition.getKnowledgeSource(sourceId, signal)).state;
            signal.throwIfAborted();
            const policy = this.approvals.get(sourceId)!;
            if (!state?.source?.enabled || state.sourceRevision !== BigInt(policy.source_revision)
              || state.declarationDigest !== policy.declaration_digest || state.source.reference?.id !== target.admission.reference.id
              || state.source.reference.revision !== target.admission.reference.revision || !target.admission.current()) {
              throw new HostCapabilityRequestError('Knowledge 来源或审批已改变');
            }
            const receipt = await this.cognition.collectKnowledgeSource(sourceId, BigInt(policy.source_revision), signal);
            signal.throwIfAborted();
            if (this.refreshTickets.get(sourceId) !== target.ticket) return;
            this.acceptReceipt(sourceId, receipt, target.admission);
          });
        } catch {
          if (this.stopped || this.refreshTickets.get(sourceId) !== target.ticket) continue;
          let errorCode = 'knowledge_refresh_failed';
          try { this.revoke(sourceId); } catch { errorCode = 'knowledge_refresh_cleanup_failed'; }
          this.markSource(sourceId, 'failed', errorCode);
        }
      }
    }).finally(() => { this.refreshTask = undefined; this.scheduleRefresh(); });
  }
  private run<T>(sourceId: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.stopped) return Promise.reject(new HostCapabilityRequestError('Knowledge controller 已停止'));
    validateSecurityIdentity(sourceId);
    const abort = new AbortController(), prior = this.pending.get(sourceId);
    const controllers = this.aborts.get(sourceId) ?? new Set<AbortController>();
    controllers.add(abort); this.aborts.set(sourceId, controllers);
    const task = (async () => {
      await prior?.catch(() => undefined); abort.signal.throwIfAborted();
      return operation(abort.signal);
    })().finally(() => {
      controllers.delete(abort); if (!controllers.size) this.aborts.delete(sourceId);
      if (this.pending.get(sourceId) === task) this.pending.delete(sourceId);
    });
    this.pending.set(sourceId, task); return task;
  }
}

/** Schema 之后的实际字节/JSON/唯一性门；loader 在创建任何库/进程前调用。 */
export function validateHostKnowledgeApprovals(approvals: readonly HostKnowledgeApproval[]): void {
  if (approvals.length > 1024) throw new HostCapabilityRequestError('Knowledge 审批过多');
  const ids = new Set<string>();
  for (const value of approvals) {
    validateSecurityIdentity(value.source_id);
    if (ids.has(value.source_id) || !Number.isSafeInteger(value.source_revision) || value.source_revision < 1
      || !/^[a-f0-9]{64}$/.test(value.declaration_digest) || !Number.isSafeInteger(value.max_age_ms)
      || value.max_age_ms < 1 || value.max_age_ms > 86_400_000 || !Number.isSafeInteger(value.expires_at_ms)
      || value.expires_at_ms < 1 || !value.arguments || Array.isArray(value.arguments)) throw new HostCapabilityRequestError('Knowledge 审批无效');
    assertJson(value.arguments);
    if (Buffer.byteLength(JSON.stringify(value.arguments), 'utf8') > 32 * 1024) throw new HostCapabilityRequestError('Knowledge 审批参数过大');
    ids.add(value.source_id);
  }
}
function assertJson(value: unknown, depth = 0): void {
  if (depth > 64) throw new HostCapabilityRequestError('Knowledge 参数嵌套过深');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || !value) throw new HostCapabilityRequestError('Knowledge 参数不是 JSON');
  for (const child of Object.values(value)) assertJson(child, depth + 1);
}

function freezeJson(value: unknown): void {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeJson(child); Object.freeze(value); }
}
