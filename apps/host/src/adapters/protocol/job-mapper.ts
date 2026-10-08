import { createHash } from 'node:crypto';
import { create, toBinary, type JsonObject } from '@bufbuild/protobuf';
import { JobExecutionIdentitySchema, JobStateEventSchema, JobStatus, type JobExecutionIdentity } from '@glimmer-cradle/contracts/glimmer/jobs/v1/jobs_pb';
import { MemoryJobResolution, PlanningJobResolution, PlanningJobResultSchema, PlanningJobSourceRequestSchema,
  type MemoryJobSourceRequest, type MemoryJobResult, type PlanningJobSourceRequest, type PlanningJobResult } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { JobConflictError, type JobSource, type JobRequest, type Job, type JobAttempt, type JobReconciliationEvidence, type JobStateEvent } from '@glimmer-cradle/jobs';

export function memoryJobState(event: JobStateEvent) {
  const statuses = { queued: JobStatus.QUEUED, running: JobStatus.RUNNING, retry_wait: JobStatus.RETRY_WAIT,
    succeeded: JobStatus.SUCCEEDED, cancelled: JobStatus.CANCELLED, dead_letter: JobStatus.DEAD_LETTER, unknown: JobStatus.UNKNOWN };
  if (event.kind !== MEMORY_JOB_KIND || !Object.hasOwn(statuses, event.status)
    || ![event.attempt, event.fencing_token, event.updated_at].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new JobConflictError('Memory Job 状态事实无效');
  }
  return create(JobStateEventSchema, { eventId: text(event.event_id), jobId: text(event.job_id), scopeId: text(event.scope_id),
    goalId: text(event.goal_id), kind: event.kind, revision: BigInt(positive(event.revision)), status: statuses[event.status],
    attempt: BigInt(event.attempt), authorityEpoch: BigInt(positive(event.authority_epoch)), fencingToken: BigInt(event.fencing_token),
    updatedAtMs: BigInt(event.updated_at), ...(event.error_code === null ? {} : { errorCode: event.error_code }),
    ...(event.result === null ? {} : { result: event.result as JsonObject }) });
}

export const MEMORY_JOB_KIND = 'memory.consolidate';
export const PLANNING_JOB_KIND = 'planning.evaluate';
export function planningJobSource(source: PlanningJobSourceRequest): JobSource {
  return { source_id: 'cognition.planning', source_request_id: source.requestId,
    input_digest: createHash('sha256').update(JSON.stringify([source.requestId, source.commitmentId, source.planId,
      source.planVersion.toString(), source.goalId, source.goalVersion.toString(), source.scopeId, source.dueAtMs.toString()])).digest('hex') };
}
export function planningJobRequest(source: PlanningJobSourceRequest, maxAttempts: number): JobRequest {
  if (toBinary(PlanningJobSourceRequestSchema, source).byteLength > 65536) throw new JobConflictError('Planning 源请求超过大小限制');
  const planVersion = positive(Number(source.planVersion)), goalVersion = positive(Number(source.goalVersion));
  const commitment = text(source.commitmentId), plan = text(source.planId), goal = text(source.goalId), scope = text(source.scopeId);
  const due = Number(source.dueAtMs);
  const expected = createHash('sha256').update(JSON.stringify([PLANNING_JOB_KIND, commitment, plan, planVersion])).digest('hex');
  if (source.requestId !== expected || !Number.isSafeInteger(due) || due < 0) throw new JobConflictError('Planning 源 request identity/due 无效');
  return { job_id: `planning:${source.requestId}`, goal_id: goal, scope_id: scope, kind: PLANNING_JOB_KIND,
    idempotency_key: source.requestId, payload: { source_request_id: source.requestId, commitment_id: commitment,
      plan_id: plan, plan_version: planVersion, goal_version: goalVersion }, due_at: due,
    retry_mode: 'reconcile', max_attempts: positive(maxAttempts) };
}
export interface MemoryJobSubmissionPolicy { readonly debounce_ms: number; readonly max_attempts: number; }
export function memoryJobSource(source: MemoryJobSourceRequest): JobSource {
  return { source_id: 'cognition.memory', source_request_id: source.requestId,
    input_digest: createHash('sha256').update(JSON.stringify([source.requestId, source.episodeId,
      source.episodeVersion.toString(), source.scopeId, source.inputDigest, source.createdAt])).digest('hex') };
}
function positive(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new JobConflictError('Job 原执行整数无效');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new JobConflictError('Job identity 为空');
  return value;
}
export function memoryJobRequest(source: MemoryJobSourceRequest, policy: MemoryJobSubmissionPolicy): JobRequest {
  const version = positive(Number(source.episodeVersion));
  const scope = text(source.scopeId), episode = text(source.episodeId), digest = text(source.inputDigest);
  const expected = createHash('sha256').update(JSON.stringify([episode, version, scope, digest])).digest('hex');
  const created = Date.parse(source.createdAt);
  if (source.requestId !== expected || !/^[a-f0-9]{64}$/.test(digest)
    || !Number.isSafeInteger(created) || created < 0 || !Number.isSafeInteger(policy.debounce_ms) || policy.debounce_ms < 0
    || !Number.isSafeInteger(created + policy.debounce_ms)) throw new JobConflictError('Memory 源 request 摘要或时间无效');
  return { job_id: `memory:${source.requestId}`, scope_id: scope, goal_id: source.requestId, kind: MEMORY_JOB_KIND,
    idempotency_key: source.requestId, payload: { source_request_id: source.requestId, episode_id: episode,
      episode_version: version, input_digest: digest }, due_at: created + policy.debounce_ms,
    retry_mode: 'reconcile', max_attempts: positive(policy.max_attempts) };
}
export function memoryJobIdentity(job: Job, attempt?: JobAttempt): JobExecutionIdentity {
  return jobExecutionIdentity(job, attempt);
}
function jobExecutionIdentity(job: Job, attempt?: JobAttempt): JobExecutionIdentity {
  const original = attempt ?? { job_id: job.job_id, attempt: job.attempt, authority_epoch: job.authority_epoch,
    fencing_token: job.fencing_token, owner_id: job.lease_owner!, lease_until: job.lease_until! };
  return create(JobExecutionIdentitySchema, { jobId: text(original.job_id), scopeId: text(job.scope_id),
    attempt: BigInt(positive(original.attempt)), authorityEpoch: BigInt(positive(original.authority_epoch)),
    fencingToken: BigInt(positive(original.fencing_token)), ownerId: text(original.owner_id),
    leaseUntilMs: BigInt(positive(original.lease_until)) });
}

export function planningJobRequestId(job: Job): string {
  const request = job.payload.source_request_id;
  if (typeof job.payload.plan_version !== 'number' || typeof job.payload.goal_version !== 'number'
    || job.idempotency_key !== request) throw new JobConflictError('Planning 原源版本/去重身份无效');
  positive(job.payload.goal_version);
  const expected = createHash('sha256').update(JSON.stringify([PLANNING_JOB_KIND,
    text(job.payload.commitment_id), text(job.payload.plan_id), positive(Number(job.payload.plan_version))])).digest('hex');
  if (job.kind !== PLANNING_JOB_KIND || request !== expected || job.job_id !== `planning:${request}`) {
    throw new JobConflictError('Planning 原 Job/source identity 无效');
  }
  return expected;
}
export function planningJobIdentity(job: Job, attempt?: JobAttempt): JobExecutionIdentity {
  planningJobRequestId(job);
  if (attempt !== undefined && attempt.job_id !== job.job_id) throw new JobConflictError('Planning 原 attempt 绑定无效');
  return jobExecutionIdentity(job, attempt);
}

export function planningJobEvidence(result: PlanningJobResult | undefined, identity: JobExecutionIdentity,
  requestId: string, commitmentId: string): JobReconciliationEvidence {
  const actual = result?.identity;
  if (!result || !actual || !/^[a-f0-9]{64}$/.test(requestId) || identity.jobId !== `planning:${requestId}`
    || actual.jobId !== identity.jobId || actual.scopeId !== identity.scopeId || actual.attempt !== identity.attempt
    || actual.authorityEpoch !== identity.authorityEpoch || actual.fencingToken !== identity.fencingToken
    || actual.ownerId !== identity.ownerId || actual.leaseUntilMs !== identity.leaseUntilMs
    || result.requestId !== requestId || result.sourceId !== 'cognition.planning' || result.receiverFenced !== true
    || toBinary(PlanningJobResultSchema, result).byteLength > 65536) throw new JobConflictError('Planning 原 attempt 对账身份无效');
  const observed = Number(result.observedAtMs);
  if (!Number.isSafeInteger(observed) || observed < 0) throw new JobConflictError('Planning 对账时间无效');
  const resolution = result.resolution === PlanningJobResolution.APPLIED ? 'applied'
    : result.resolution === PlanningJobResolution.NOT_APPLIED ? 'not_applied' : null;
  if (!resolution) throw new JobConflictError('Planning 对账终态无效');
  const base = { job_id: actual.jobId, scope_id: actual.scopeId, attempt: positive(Number(actual.attempt)),
    authority_epoch: positive(Number(actual.authorityEpoch)), fencing_token: positive(Number(actual.fencingToken)),
    owner_id: actual.ownerId, source_id: result.sourceId, evidence_id: result.evidenceId, observed_at: observed };
  const expected = createHash('sha256').update(JSON.stringify(['planning-reconciliation.v1', actual.jobId, actual.scopeId,
    base.attempt, base.authority_epoch, base.fencing_token, actual.ownerId, positive(Number(actual.leaseUntilMs)),
    requestId, resolution, resolution === 'applied' ? result.receipt?.receiptId : 'sealed', observed])).digest('hex');
  if (result.evidenceId !== expected) throw new JobConflictError('Planning 持久对账摘要无效');
  if (resolution === 'not_applied') {
    if (result.receipt !== undefined) throw new JobConflictError('Planning 未接纳证明不得携带业务 receipt');
    return { ...base, resolution, receiver_fenced: true };
  }
  const receipt = result.receipt, original = receipt?.identity;
  const receiptId = createHash('sha256').update(`planning-evaluation.v1:${requestId}`).digest('hex');
  if (!receipt || !original || receipt.receiptId !== receiptId || receipt.requestId !== requestId
    || receipt.commitmentId !== commitmentId || original.jobId !== actual.jobId || original.scopeId !== actual.scopeId
    || positive(Number(original.attempt)) > base.attempt || positive(Number(original.authorityEpoch)) > base.authority_epoch
    || positive(Number(original.fencingToken)) > base.fencing_token
    || original.attempt === actual.attempt && (original.authorityEpoch !== actual.authorityEpoch
      || original.fencingToken !== actual.fencingToken || original.ownerId !== actual.ownerId)
    || !Number.isSafeInteger(Number(receipt.committedAtMs)) || Number(receipt.committedAtMs) < 0
    || Number(receipt.committedAtMs) > observed || positive(Number(original.leaseUntilMs)) <= Number(receipt.committedAtMs)) {
    throw new JobConflictError('Planning 持久业务 receipt/提交者身份无效');
  }
  const boundedText = (value: string, limit: number): string => {
    if (!value.trim() || Buffer.byteLength(value, 'utf8') > limit) throw new JobConflictError('Planning receipt 文本/预算无效');
    return value;
  };
  const references = receipt.evidence.map(item => {
    if (!['conversation', 'knowledge', 'execution'].includes(item.sourceOwner) || item.scopeId !== actual.scopeId
      || !/^[a-f0-9]{64}$/.test(item.contentDigest)) throw new JobConflictError('Planning receipt 证据 owner/scope/hash 无效');
    return { evidence_id: boundedText(item.evidenceId, 4096), source_owner: item.sourceOwner,
      scope_id: item.scopeId, revision: positive(Number(item.revision)), content_digest: item.contentDigest };
  });
  const evidenceIds = receipt.evidenceIds.map(value => boundedText(value, 4096));
  const available = new Set(references.map(item => item.evidence_id));
  if (references.length > 64 || evidenceIds.length > 64 || available.size !== references.length
    || new Set(evidenceIds).size !== evidenceIds.length || evidenceIds.some(value => !available.has(value))
    || receipt.completed && evidenceIds.length === 0) throw new JobConflictError('Planning receipt 评估引用无效');
  // 保留 completed=false 与原提交者；成功 Job 不代替 Cognition 的语义完成条件。
  return { ...base, resolution, result: { receipt_id: receiptId, request_id: requestId,
    commitment_id: boundedText(receipt.commitmentId, 4096), commitment_revision: positive(Number(receipt.commitmentRevision)),
    assessment: { completed: receipt.completed, evidence_ids: evidenceIds, reason: boundedText(receipt.reason, 2000) },
    evidence: references, committed_at: Number(receipt.committedAtMs), identity: {
      job_id: original.jobId, scope_id: original.scopeId, attempt: Number(original.attempt),
      authority_epoch: Number(original.authorityEpoch), fencing_token: Number(original.fencingToken),
      owner_id: boundedText(original.ownerId, 4096), lease_until: Number(original.leaseUntilMs) } } };
}
export function memoryJobEvidence(result: MemoryJobResult | undefined, identity: JobExecutionIdentity): JobReconciliationEvidence {
  const actual = result?.identity;
  if (!result || !actual || actual.jobId !== identity.jobId || actual.scopeId !== identity.scopeId
    || actual.attempt !== identity.attempt || actual.authorityEpoch !== identity.authorityEpoch
    || actual.fencingToken !== identity.fencingToken || actual.ownerId !== identity.ownerId
    || actual.leaseUntilMs !== identity.leaseUntilMs || result.sourceId !== 'cognition.memory'
    || result.receiverFenced !== true) throw new JobConflictError('Memory 原 attempt 证据身份不匹配');
  const resolution = result.resolution === MemoryJobResolution.APPLIED ? 'applied'
    : result.resolution === MemoryJobResolution.NOT_APPLIED ? 'not_applied' : null;
  if (!resolution) throw new JobConflictError('Memory 证据终态无效');
  const evidence = createHash('sha256').update(JSON.stringify([actual.jobId, actual.scopeId, Number(actual.attempt),
    Number(actual.authorityEpoch), Number(actual.fencingToken), actual.ownerId, resolution,
    resolution === 'applied' ? result.receiptId : 'sealed'])).digest('hex');
  if (result.evidenceId !== evidence) throw new JobConflictError('Memory 持久证据摘要无效');
  const base = { job_id: actual.jobId, scope_id: actual.scopeId, attempt: positive(Number(actual.attempt)),
    authority_epoch: positive(Number(actual.authorityEpoch)), fencing_token: positive(Number(actual.fencingToken)),
    owner_id: actual.ownerId, source_id: result.sourceId, evidence_id: result.evidenceId,
    observed_at: positive(Number(result.observedAtMs)) };
  if (resolution === 'not_applied') {
    if (result.receiptId || result.operationId || result.memoryIds.length || result.committedAt) {
      throw new JobConflictError('Memory 未执行证据含业务结果');
    }
    return { ...base, resolution, receiver_fenced: true };
  }
  if (!Number.isFinite(Date.parse(result.committedAt)) || new Set(result.memoryIds).size !== result.memoryIds.length) {
    throw new JobConflictError('Memory receipt 结果无效');
  }
  return { ...base, resolution, result: { receipt_id: text(result.receiptId), operation_id: text(result.operationId),
    memory_ids: result.memoryIds.map(text), committed_at: result.committedAt } };
}
