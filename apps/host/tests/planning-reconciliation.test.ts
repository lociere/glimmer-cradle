import { createHash } from 'node:crypto';
import { create } from '@bufbuild/protobuf';
import { it, expect } from 'vitest';
import { JobExecutionIdentitySchema } from '@glimmer-cradle/contracts/glimmer/jobs/v1/jobs_pb';
import { PlanningJobResultSchema, PlanningJobResolution, type PlanningJobResult } from '@glimmer-cradle/contracts/glimmer/cognition/v1/cognition_service_pb';
import { planningJobEvidence } from '../src/adapters/protocol/job-mapper.js';

const requestId = 'a'.repeat(64), commitmentId = '承诺:一';
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
