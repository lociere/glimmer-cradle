import { createHash } from 'node:crypto';
import { create } from '@bufbuild/protobuf';
import { JobExecutionIdentitySchema, type JobExecutionIdentity } from '@glimmer-cradle/contracts/glimmer/jobs/v1/jobs_pb';
import { MemoryJobResolution, type MemoryJobSourceRequest, type MemoryJobResult } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { JobConflictError, type JobSource, type JobRequest, type Job, type JobAttempt, type JobReconciliationEvidence } from '@glimmer-cradle/jobs';

export const MEMORY_JOB_KIND = 'memory.consolidate';
export interface MemoryJobSubmissionPolicy { readonly debounce_ms: number; readonly max_attempts: number; }
export function memoryJobSource(source: MemoryJobSourceRequest): JobSource {
  return { source_id: 'cognition.memory', source_request_id: source.requestId,
    input_digest: createHash('sha256').update(JSON.stringify([source.requestId, source.episodeId,
      source.episodeVersion.toString(), source.scopeId, source.inputDigest, source.createdAt])).digest('hex') };
}
function positive(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new JobConflictError('Memory Job 原执行整数无效');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new JobConflictError('Memory Job identity 为空');
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
  const original = attempt ?? { job_id: job.job_id, attempt: job.attempt, authority_epoch: job.authority_epoch,
    fencing_token: job.fencing_token, owner_id: job.lease_owner!, lease_until: job.lease_until! };
  return create(JobExecutionIdentitySchema, { jobId: text(original.job_id), scopeId: text(job.scope_id),
    attempt: BigInt(positive(original.attempt)), authorityEpoch: BigInt(positive(original.authority_epoch)),
    fencingToken: BigInt(positive(original.fencing_token)), ownerId: text(original.owner_id),
    leaseUntilMs: BigInt(positive(original.lease_until)) });
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
