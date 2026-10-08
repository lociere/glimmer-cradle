import { create } from '@bufbuild/protobuf';
import { ExecuteMemoryJobRequestSchema, ReconcileMemoryJobRequestSchema, ReadMemoryJobRequestsRequestSchema,
  AcknowledgeMemoryJobRequestRequestSchema, PublishMemoryJobStateRequestSchema,
  ReadPlanningJobRequestsRequestSchema, AcknowledgePlanningJobRequestRequestSchema,
  ReconcilePlanningJobRequestSchema, ExecutePlanningJobRequestSchema, GetPlanningJobAdmissionRequestSchema } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { JobConflictError, type Job, type JobAttempt, type JobClockPort, type JobStorePort, type JobExecutionContext,
  type JobHandlerPort, type JobHandlerResult, type JobAdmissionPort, type JobReconciliationPort, type JobReconciliationEvidence, type JobStateReceiverPort } from '@glimmer-cradle/jobs';
import type { MemoryJobsCognitionPort, PlanningJobsSourcePort, PlanningJobsReconciliationPort, PlanningJobsCognitionPort } from '../adapters/protocol/cognition-client.js';
import { MEMORY_JOB_KIND, PLANNING_JOB_KIND, memoryJobSource, memoryJobRequest, memoryJobIdentity, memoryJobEvidence,
  memoryJobState, planningJobRequest, planningJobSource, planningJobIdentity, planningJobRequestId, planningJobEvidence,
  type MemoryJobSubmissionPolicy } from '../adapters/protocol/job-mapper.js';

/** App 接线真正 Jobs 与 Memory owner；不持有推理或第二套重试状态。 */
export class CognitionJobAdapter implements JobHandlerPort, JobReconciliationPort {
  public readonly kind = MEMORY_JOB_KIND;
  public readonly retry_mode = 'reconcile' as const;
  public constructor(private readonly cognition: MemoryJobsCognitionPort) {}

  public stateReceiver(epoch: number): JobStateReceiverPort {
    if (!Number.isSafeInteger(epoch) || epoch < 1) throw new JobConflictError('Memory 状态投递主无效');
    return { accept: async (event, signal) => {
      const response = await this.cognition.publishJobState(create(PublishMemoryJobStateRequestSchema,
        { event: memoryJobState(event), deliveryAuthorityEpoch: BigInt(epoch) }), signal);
      if (!response.accepted || response.eventId !== event.event_id) throw new JobConflictError('Memory 状态 ACK 身份不匹配');
      return { event_id: response.eventId, accepted: true };
    } };
  }

  public async execute(context: JobExecutionContext, payload: Job['payload']): Promise<JobHandlerResult> {
    context.assertLease();
    const identity = memoryJobIdentity(context.job);
    if (typeof payload.episode_id !== 'string' || !payload.episode_id.trim()
      || typeof payload.input_digest !== 'string' || !/^[a-f0-9]{64}$/.test(payload.input_digest)
      || !Number.isSafeInteger(payload.episode_version) || Number(payload.episode_version) < 1) {
      return { status: 'failed', error_code: 'memory_payload_invalid', retryable: false, effects: 'none' };
    }
    let response;
    try {
      response = await this.cognition.execute(create(ExecuteMemoryJobRequestSchema, { identity,
        episodeId: payload.episode_id, episodeVersion: BigInt(Number(payload.episode_version)), inputDigest: payload.input_digest }), context.signal);
    } catch (error) {
      if (context.signal.aborted) {
        // 本地取消不是接收端封口证明；用独立的有界 RPC 封口，不能复用已取消 signal。
        const sealed = await this.cognition.reconcile(create(ReconcileMemoryJobRequestSchema, { identity }));
        memoryJobEvidence(sealed.result, identity);
      }
      throw error;
    }
    const proof = memoryJobEvidence(response.result, identity);
    context.assertLease();
    if (proof.resolution !== 'applied') throw new JobConflictError('Memory Execute 未返回持久业务结果');
    return { status: 'succeeded', result: proof.result };
  }
  public async query(job: Job, attempt: JobAttempt, signal?: AbortSignal): Promise<JobReconciliationEvidence> {
    signal?.throwIfAborted();
    const identity = memoryJobIdentity(job, attempt);
    const response = await this.cognition.reconcile(create(ReconcileMemoryJobRequestSchema, { identity }), signal);
    signal?.throwIfAborted();
    return memoryJobEvidence(response.result, identity);
  }
  public async deliverRequests(store: JobStorePort, clock: JobClockPort, epoch: number,
    policy: MemoryJobSubmissionPolicy, limit: number, signal?: AbortSignal): Promise<number> {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new JobConflictError('Memory 源投递扫描范围无效');
    const response = await this.cognition.readRequests(create(ReadMemoryJobRequestsRequestSchema, { limit }), signal);
    if (response.requests.length > limit) {
      throw new JobConflictError('Memory 源投递扫描范围无效');
    }
    let delivered = 0;
    for (const source of response.requests) {
      signal?.throwIfAborted();
      const submission = store.enqueueSource(memoryJobSource(source), memoryJobRequest(source, policy), epoch, clock.now());
      // Jobs commit 之后再 ACK；断连/取消不能撤销已入队事实，只能重放原 request。
      signal?.throwIfAborted();
      const ack = await this.cognition.acknowledge(create(AcknowledgeMemoryJobRequestRequestSchema,
        { request: source, jobId: submission.job_id }), signal);
      signal?.throwIfAborted();
      if (!ack.accepted || ack.requestId !== source.requestId || ack.jobId !== submission.job_id) {
        throw new JobConflictError('Memory 源请求 ACK identity 不匹配');
      }
      delivered += 1;
    }
    return delivered;
  }
}

/** 真实生产源接纳；先 Jobs commit 后 ACK，不模拟执行或状态 ACK。 */
export class PlanningJobSourceAdapter implements JobReconciliationPort {
  public readonly kind = PLANNING_JOB_KIND;
  public constructor(private readonly cognition: PlanningJobsSourcePort & PlanningJobsReconciliationPort) {}
  public async query(job: Job, attempt: JobAttempt, signal?: AbortSignal): Promise<JobReconciliationEvidence> {
    signal?.throwIfAborted();
    const identity = planningJobIdentity(job, attempt), requestId = String(job.payload.source_request_id);
    const response = await this.cognition.reconcilePlanning(create(ReconcilePlanningJobRequestSchema,
      { identity, requestId }), signal);
    signal?.throwIfAborted();
    return planningJobEvidence(response.result, identity, requestId, String(job.payload.commitment_id));
  }
  public async deliverRequests(store: JobStorePort, clock: JobClockPort, epoch: number,
    maxAttempts: number, limit: number, signal?: AbortSignal): Promise<number> {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new JobConflictError('Planning 源投递扫描范围无效');
    const response = await this.cognition.readPlanningRequests(create(ReadPlanningJobRequestsRequestSchema, { limit }), signal);
    if (response.requests.length > limit) throw new JobConflictError('Planning 源返回超过扫描范围');
    let delivered = 0;
    for (const source of response.requests) {
      signal?.throwIfAborted();
      const request = planningJobRequest(source, maxAttempts);
      const submission = store.enqueueSource(planningJobSource(source), request, epoch, clock.now());
      signal?.throwIfAborted();
      const ack = await this.cognition.acknowledgePlanning(create(AcknowledgePlanningJobRequestRequestSchema,
        { request: source, jobId: submission.job_id, jobRevision: BigInt(submission.revision), duplicate: submission.duplicate }), signal);
      signal?.throwIfAborted();
      if (!ack.accepted || ack.requestId !== source.requestId || ack.jobId !== submission.job_id) throw new JobConflictError('Planning 源请求 ACK identity 不匹配');
      delivered += 1;
    }
    return delivered;
  }
}

/** 实际 Planning 接纳/执行/对账；claim 前采样不替代 Execute 的 live 政策复验。 */
export class PlanningJobAdapter implements JobHandlerPort, JobReconciliationPort, JobAdmissionPort {
  public readonly kind = PLANNING_JOB_KIND;
  public readonly retry_mode = 'reconcile' as const;
  public constructor(private readonly cognition: PlanningJobsCognitionPort) {}
  public async isEligible(job: Job, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted();
    const requestId = planningJobRequestId(job);
    const response = await this.cognition.getPlanningAdmission(create(GetPlanningJobAdmissionRequestSchema,
      { requestId, jobId: job.job_id, scopeId: job.scope_id }), signal);
    signal?.throwIfAborted();
    const waiting = ['planning_source_unbound', 'planning_source_unavailable', 'planning_model_policy', 'planning_model_unavailable'];
    if (response.requestId !== requestId || response.jobId !== job.job_id || response.scopeId !== job.scope_id
      || response.eligible !== (response.reasonCode === 'planning_ready')
      || !response.eligible && !waiting.includes(response.reasonCode)) throw new JobConflictError('Planning 接纳响应身份/状态无效');
    return response.eligible;
  }
  public async execute(context: JobExecutionContext, payload: Job['payload']): Promise<JobHandlerResult> {
    context.assertLease();
    const identity = planningJobIdentity(context.job), requestId = String(payload.source_request_id);
    let response;
    try {
      response = await this.cognition.executePlanning(create(ExecutePlanningJobRequestSchema, { identity, requestId }), context.signal);
    } catch (error) {
      if (context.signal.aborted) {
        // 已取消的 signal 不能给接收端封口；独立有界 RPC 完成后再交还 Jobs。
        const sealed = await this.cognition.reconcilePlanning(create(ReconcilePlanningJobRequestSchema, { identity, requestId }));
        planningJobEvidence(sealed.result, identity, requestId, String(payload.commitment_id));
      }
      throw error;
    }
    const proof = planningJobEvidence(response.result, identity, requestId, String(payload.commitment_id));
    context.assertLease();
    if (proof.resolution !== 'applied') throw new JobConflictError('Planning Execute 缺少真实业务 receipt');
    return { status: 'succeeded', result: proof.result };
  }
  public async query(job: Job, attempt: JobAttempt, signal?: AbortSignal): Promise<JobReconciliationEvidence> {
    signal?.throwIfAborted();
    const identity = planningJobIdentity(job, attempt), requestId = String(job.payload.source_request_id);
    const response = await this.cognition.reconcilePlanning(create(ReconcilePlanningJobRequestSchema, { identity, requestId }), signal);
    signal?.throwIfAborted();
    return planningJobEvidence(response.result, identity, requestId, String(job.payload.commitment_id));
  }
}
