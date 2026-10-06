import { create } from '@bufbuild/protobuf';
import { ExecuteMemoryJobRequestSchema, ReconcileMemoryJobRequestSchema, ReadMemoryJobRequestsRequestSchema,
  AcknowledgeMemoryJobRequestRequestSchema } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { JobConflictError, type Job, type JobAttempt, type JobClockPort, type JobStorePort, type JobExecutionContext,
  type JobHandlerPort, type JobHandlerResult, type JobReconciliationPort, type JobReconciliationEvidence } from '@glimmer-cradle/jobs';
import type { MemoryJobsCognitionPort } from '../adapters/protocol/cognition-client.js';
import { MEMORY_JOB_KIND, memoryJobRequest, memoryJobIdentity, memoryJobEvidence,
  type MemoryJobSubmissionPolicy } from '../adapters/protocol/job-mapper.js';

/** App 接线真正 Jobs 与 Memory owner；不持有推理或第二套重试状态。 */
export class CognitionJobAdapter implements JobHandlerPort, JobReconciliationPort {
  public readonly kind = MEMORY_JOB_KIND;
  public readonly retry_mode = 'reconcile' as const;
  public constructor(private readonly cognition: MemoryJobsCognitionPort) {}

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
      const submission = store.enqueue(memoryJobRequest(source, policy), epoch, clock.now());
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
