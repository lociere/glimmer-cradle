import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DeliveryController, SqliteDeliveryStore } from '@glimmer-cradle/conversation';
import { create } from '@bufbuild/protobuf';
import { it, expect, vi } from 'vitest';
import type { Job } from '@glimmer-cradle/jobs';
import { JobExecutionIdentitySchema } from '@glimmer-cradle/contracts/glimmer/jobs/v1/jobs_pb';
import { PlanningJobResultSchema, PlanningJobResolution, PlanningJobSourceRequestSchema, GetPlanningJobAdmissionResponseSchema,
  type PlanningJobResult, type GetPlanningJobAdmissionRequest } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { PreparePlanningNotificationResponseSchema, AcknowledgePlanningNotificationResponseSchema } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { CognitionClient } from '../src/adapters/protocol/cognition-client.js';
import { planningJobEvidence, planningJobRequest } from '../src/adapters/protocol/job-mapper.js';
import { PlanningJobAdapter } from '../src/composition/cognition-job-adapter.js';

const requestId = 'a'.repeat(64), commitmentId = '承诺:一';

it.each(['delivered', 'completed', 'new-owner', 'generated', 'queued', 'sent', 'unknown', 'playing', 'stale-owner',
  'turn', 'digest', 'destination', 'accepted', 'request', 'context', 'revision', 'position', 'overflow', 'response'] as const)
('Planning 源确认只读实际 Delivery owner，拒绝无确认/错绑定 %s', async mode => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'glimmer-notification-receipt-'));
  const store = new SqliteDeliveryStore(path.join(root, 'delivery.db'));
  const original = new DeliveryController(store, 'epoch:first');
  let delivery = original;
  const receiptId = createHash('sha256').update(`planning-evaluation.v1:${requestId}`).digest('hex');
  const notificationId = createHash('sha256').update(`planning-completion.v1:${receiptId}`).digest('hex');
  const turnId = createHash('sha256').update(`conversation-notification-turn.v1:${notificationId}`).digest('hex');
  const prepared = create(PreparePlanningNotificationResponseSchema, { accepted: true, turnId, turnRevision: 2n,
    replyMomentId: 'moment:original', logPosition: 2n, contentDigest: 'f'.repeat(64), context: { sceneId: 'scene:private' },
    request: { notificationId, receiptId, requestId, jobId: `planning:${requestId}`, commitmentId, commitmentRevision: 2n,
      goalId: 'goal:original', goalVersion: 1n, scopeId: 'conversation:original', sourceMomentId: 'moment:source', sourceDigest: 'e'.repeat(64) } });
  const outputId = 'reply:' + turnId;
  const client = new CognitionClient('grpc://127.0.0.1:1', 'generation:current', 500);
  // 这里只验证实际 SQLite→Host mapper；真实 RPC/Worker/重启另由 production CLI fixture 覆盖。
  const call = vi.spyOn(client as unknown as { call: (...args: unknown[]) => Promise<unknown> }, 'call')
    .mockResolvedValue(create(AcknowledgePlanningNotificationResponseSchema, { accepted: true,
      notificationId: mode === 'response' ? 'foreign' : notificationId }));
  try {
    delivery.begin({ output_id: outputId, turn_id: mode === 'turn' ? 'foreign' : turnId,
      destination_id: mode === 'destination' ? 'foreign' : 'scene:private', content_digest: mode === 'digest' ? 'e'.repeat(64) : 'f'.repeat(64) });
    if (mode !== 'generated') delivery.queue(outputId);
    if (mode !== 'generated' && mode !== 'queued') delivery.sent(outputId);
    if (mode === 'unknown') delivery.unknown(outputId, 'actual_disconnect');
    else if (!['generated', 'queued', 'sent'].includes(mode)) {
      if (mode === 'completed') delivery.applyReceipt({ output_id: outputId, destination_id: 'scene:private',
        authority_epoch: 'epoch:first', generation: 1, received_at: '2026-10-08T00:00:00Z',
        receipt: { receipt_id: 'receipt:started', kind: 'playback_started' } });
      expect(delivery.applyReceipt({ output_id: outputId, destination_id: mode === 'destination' ? 'foreign' : 'scene:private',
        authority_epoch: 'epoch:first', generation: 1, received_at: '2026-10-08T00:00:00Z',
        receipt: mode === 'playing' ? { receipt_id: 'receipt:actual', kind: 'playback_started' }
          : mode === 'completed' ? { receipt_id: 'receipt:actual', kind: 'playback_completed', heard_through_ms: 125, duration_ms: 300 }
          : { receipt_id: 'receipt:actual', kind: 'delivered' } })).toEqual({ accepted: true });
    }
    if (mode === 'new-owner') delivery = new DeliveryController(store, 'epoch:next');
    if (mode === 'stale-owner') new DeliveryController(store, 'epoch:next');
    if (mode === 'accepted') prepared.accepted = false;
    if (mode === 'request') prepared.request = undefined;
    if (mode === 'context') prepared.context = undefined;
    if (mode === 'revision') prepared.turnRevision = 3n;
    if (mode === 'position') prepared.logPosition = 0n;
    if (mode === 'overflow') prepared.logPosition = 9007199254740992n;
    if (['delivered', 'completed', 'new-owner'].includes(mode)) {
      expect(await client.acknowledgeDeliveredPlanningNotification(prepared, outputId, delivery)).toMatchObject({ accepted: true, notificationId });
      expect(call).toHaveBeenCalledOnce();
      const request = call.mock.calls[0][3] as { confirmation: { receipt: { kind: string; authorityEpoch: string }; contentDigest: string } };
      expect(request.confirmation.contentDigest).toBe('f'.repeat(64));
      expect(request.confirmation.receipt.authorityEpoch).toBe('epoch:first');
      expect(request.confirmation.receipt.kind).toBe(mode === 'completed' ? 'playback_completed' : 'delivered');
    } else {
      await expect(client.acknowledgeDeliveredPlanningNotification(prepared, outputId, delivery)).rejects.toThrow();
      expect(call).toHaveBeenCalledTimes(mode === 'response' ? 1 : 0);
    }
  } finally { client.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});
const identity = create(JobExecutionIdentitySchema, { jobId: `planning:${requestId}`, scopeId: '对话:私有',
  attempt: 2n, authorityEpoch: 2n, fencingToken: 2n, ownerId: '接任者', leaseUntilMs: 1000n });
function sign(result: PlanningJobResult) {
  const actual = result.identity!;
  result.evidenceId = createHash('sha256').update(JSON.stringify(['planning-reconciliation.v1', actual.jobId, actual.scopeId,
    Number(actual.attempt), Number(actual.authorityEpoch), Number(actual.fencingToken), actual.ownerId,
    Number(actual.leaseUntilMs), result.requestId, result.resolution === PlanningJobResolution.APPLIED ? 'applied' : 'not_applied',
    result.resolution === PlanningJobResolution.APPLIED ? result.receipt?.receiptId : 'sealed', Number(result.observedAtMs)])).digest('hex');
  return result;
}
function result(applied = true, completed = false) {
  return sign(create(PlanningJobResultSchema, { identity: { ...identity }, requestId, sourceId: 'cognition.planning', receiverFenced: true,
    resolution: applied ? PlanningJobResolution.APPLIED : PlanningJobResolution.NOT_APPLIED, observedAtMs: 200n,
    ...(applied ? { receipt: {
      receiptId: createHash('sha256').update(`planning-evaluation.v1:${requestId}`).digest('hex'),
      identity: { ...identity, attempt: 1n, authorityEpoch: 1n, fencingToken: 1n, ownerId: '原提交者' },
      requestId, commitmentId, commitmentRevision: 2n, completed, reason: '尚未满足全部条件', committedAtMs: 100n,
      evidenceIds: ['事实:一'], evidence: [{ evidenceId: '事实:一', sourceOwner: 'conversation',
        scopeId: identity.scopeId, revision: 1n, contentDigest: 'b'.repeat(64) }],
    } } : {}) }));
}

it.each([false, true])('Planning applied 保留语义完成值 %s 与真实原提交者', completed => {
  expect(planningJobEvidence(result(true, completed), identity, requestId, commitmentId)).toMatchObject({
    resolution: 'applied', attempt: 2, owner_id: '接任者', result: {
      commitment_revision: 2, assessment: { completed }, identity: { attempt: 1, owner_id: '原提交者' },
      evidence: [{ evidence_id: '事实:一', source_owner: 'conversation' }],
    },
  });
});
it('Planning 否定证明必须没有 receipt', () => {
  expect(planningJobEvidence(result(false), identity, requestId, commitmentId)).toMatchObject({ resolution: 'not_applied', receiver_fenced: true });
  const contaminated = result(false); contaminated.receipt = result().receipt;
  expect(() => planningJobEvidence(contaminated, identity, requestId, commitmentId)).toThrow();
});
it.each(['scope', 'attempt', 'epoch', 'token', 'owner', 'lease', 'source', 'request', 'seal', 'resolution', 'digest', 'time'] as const)
('Planning 拒绝错 %s；重算摘要不能提高来源权限', mode => {
  const value = result();
  if (mode === 'scope') value.identity!.scopeId = 'foreign';
  if (mode === 'attempt') value.identity!.attempt++;
  if (mode === 'epoch') value.identity!.authorityEpoch++;
  if (mode === 'token') value.identity!.fencingToken++;
  if (mode === 'owner') value.identity!.ownerId = 'other';
  if (mode === 'lease') value.identity!.leaseUntilMs++;
  if (mode === 'source') value.sourceId = 'cognition.memory';
  if (mode === 'request') value.requestId = 'b'.repeat(64);
  if (mode === 'seal') value.receiverFenced = false;
  if (mode === 'resolution') value.resolution = PlanningJobResolution.UNSPECIFIED;
  if (mode === 'time') value.observedAtMs = 9007199254740992n;
  sign(value);
  if (mode === 'digest') value.evidenceId = 'forged';
  expect(() => planningJobEvidence(value, identity, requestId, commitmentId)).toThrow();
});
it.each(['missing', 'id', 'request', 'commitment', 'revision', 'committer', 'deadline', 'commit-time', 'future', 'owner',
  'ref-owner', 'ref-scope', 'ref-digest', 'ref-revision', 'ref-duplicate', 'foreign-ref', 'complete-empty', 'reason', 'budget'] as const)
('Planning 拒绝 receipt %s，不能用 Job success 代替完成证据', mode => {
  const value = result(), receipt = value.receipt!;
  if (mode === 'missing') value.receipt = undefined;
  if (mode === 'id') receipt.receiptId = 'forged';
  if (mode === 'request') receipt.requestId = 'b'.repeat(64);
  if (mode === 'commitment') receipt.commitmentId = 'foreign';
  if (mode === 'revision') receipt.commitmentRevision = 9007199254740992n;
  if (mode === 'committer') receipt.identity!.jobId = 'foreign';
  if (mode === 'deadline') receipt.identity!.leaseUntilMs = 100n;
  if (mode === 'commit-time') receipt.committedAtMs = 201n;
  if (mode === 'future') receipt.identity!.attempt = 3n;
  if (mode === 'owner') { receipt.identity = { ...identity, ownerId: 'foreign' }; }
  if (mode === 'ref-owner') receipt.evidence[0].sourceOwner = 'model';
  if (mode === 'ref-scope') receipt.evidence[0].scopeId = 'foreign';
  if (mode === 'ref-digest') receipt.evidence[0].contentDigest = 'forged';
  if (mode === 'ref-revision') receipt.evidence[0].revision = 0n;
  if (mode === 'ref-duplicate') receipt.evidence.push(receipt.evidence[0]);
  if (mode === 'foreign-ref') receipt.evidenceIds = ['foreign'];
  if (mode === 'complete-empty') { receipt.completed = true; receipt.evidenceIds = []; }
  if (mode === 'reason') receipt.reason = ' ';
  if (mode === 'budget') receipt.reason = 'x'.repeat(65537);
  sign(value);
  expect(() => planningJobEvidence(value, identity, requestId, commitmentId)).toThrow();
});

it.each(['ready', 'unbound', 'source', 'policy', 'model', 'request', 'job', 'scope', 'unknown-reason',
  'true-with-waiting', 'false-with-ready', 'cancel-before', 'cancel-during', 'source-drift'] as const)
('Planning 调度接纳 %s 不伪造 attempt，错身份/组合与取消失败关闭', async mode => {
  const source = create(PlanningJobSourceRequestSchema, { commitmentId, planId: 'plan:一', planVersion: 1n,
    goalId: 'goal:一', goalVersion: 1n, scopeId: identity.scopeId, dueAtMs: 0n,
    requestId: createHash('sha256').update(JSON.stringify(['planning.evaluate', commitmentId, 'plan:一', 1])).digest('hex') });
  const job: Job = { ...planningJobRequest(source, 3), status: 'queued', revision: 1, attempt: 0,
    authority_epoch: 1, fencing_token: 0, lease_owner: null, lease_until: null, result: null,
    error_code: null, created_at: 0, updated_at: 0 };
  const reason = { ready: 'planning_ready', unbound: 'planning_source_unbound', source: 'planning_source_unavailable',
    policy: 'planning_model_policy', model: 'planning_model_unavailable' };
  const response = create(GetPlanningJobAdmissionResponseSchema, { requestId: source.requestId, jobId: job.job_id,
    scopeId: job.scope_id, eligible: mode === 'ready' || mode === 'true-with-waiting',
    reasonCode: mode in reason ? reason[mode as keyof typeof reason] : 'planning_source_unbound' });
  if (mode === 'request') response.requestId = 'b'.repeat(64);
  if (mode === 'job') response.jobId = 'foreign';
  if (mode === 'scope') response.scopeId = 'foreign';
  if (mode === 'unknown-reason') response.reasonCode = 'future-ready';
  if (mode === 'false-with-ready') response.reasonCode = 'planning_ready';
  const signal = new AbortController();
  const getPlanningAdmission = vi.fn(async (request: GetPlanningJobAdmissionRequest) => {
    expect(request).toMatchObject({ requestId: source.requestId, jobId: job.job_id, scopeId: job.scope_id });
    expect(request).not.toHaveProperty('identity');
    if (mode === 'cancel-during') signal.abort();
    return response;
  });
  if (mode === 'cancel-before') signal.abort();
  const executePlanning = vi.fn(), reconcilePlanning = vi.fn();
  const adapter = new PlanningJobAdapter({ getPlanningAdmission, executePlanning, reconcilePlanning, publishPlanningState: vi.fn() });
  const candidate = mode === 'source-drift' ? { ...job, payload: { ...job.payload, plan_version: 2 } } : job;
  if (mode in reason) expect(await adapter.isEligible(job, signal.signal)).toBe(mode === 'ready');
  else await expect(adapter.isEligible(candidate, signal.signal)).rejects.toThrow();
  expect(getPlanningAdmission).toHaveBeenCalledTimes(mode === 'cancel-before' || mode === 'source-drift' ? 0 : 1);
  expect(executePlanning).not.toHaveBeenCalled(); expect(reconcilePlanning).not.toHaveBeenCalled();
  expect(job.attempt).toBe(0); expect(job.revision).toBe(1);
});
