import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { create, fromBinary, fromJson, fromJsonString, toBinary, toJsonString } from '@bufbuild/protobuf';
import { ValueSchema } from '@bufbuild/protobuf/wkt';
import { ExecutionResultState, ExecutionSideEffects, ExposeStepRequestSchema, ExposeStepResponseSchema,
  CollectKnowledgeResourceRequestSchema, CollectKnowledgeResourceResponseSchema,
  ValidateKnowledgeResourceRequestSchema, ValidateKnowledgeResourceResponseSchema,
  InvokeToolRequestSchema, InvokeToolResponseSchema, ReadCapabilityRequestSchema, ReadCapabilityResponseSchema,
  ReadSkillRequestSchema, ReadSkillResponseSchema, ReadResourceRequestSchema, ReadResourceResponseSchema } from '../../generated/ts/glimmer/capabilities/v1/capabilities_pb';
import { AcceptExecutionResultRequestSchema, AcceptExecutionResultResponseSchema } from '../../generated/ts/glimmer/conversation/v1/conversation_pb';
import {
  EchoProbeRequestSchema,
  EchoProbeResponseSchema,
} from '../../generated/ts/glimmer/common/v1/contract_probe_pb';
import {
  AvatarDownstreamFrameSchema,
} from '../../generated/ts/glimmer/avatar/v1/avatar_host_pb';
import { ContentPartSchema } from '../../generated/ts/glimmer/content/v1/content_pb';
import { JobStatus } from '../../generated/ts/glimmer/jobs/v1/jobs_pb';
import { PublishMemoryJobStateRequestSchema, PlanRequestSchema, PlanResponseSchema } from '../../generated/ts/glimmer/cognition/v1/cognition_service_pb';
import { RegisterKnowledgeResourceSourceRequestSchema, RegisterKnowledgeResourceSourceResponseSchema,
  GetKnowledgeResourceSourceRequestSchema, GetKnowledgeResourceSourceResponseSchema,
  CollectKnowledgeSourceRequestSchema, CollectKnowledgeSourceResponseSchema, KnowledgeResourceSourceSchema } from '../../generated/ts/glimmer/cognition/v1/cognition_service_pb';
import { ExecuteMemoryJobRequestSchema, ReconcileMemoryJobResponseSchema, MemoryJobResolution,
  AcknowledgeMemoryJobRequestRequestSchema, ReadPlanningJobRequestsRequestSchema,
  ReadPlanningJobRequestsResponseSchema, AcknowledgePlanningJobRequestRequestSchema,
  AcknowledgePlanningJobRequestResponseSchema, ReconcilePlanningJobRequestSchema,
  ReconcilePlanningJobResponseSchema, PlanningJobResolution, AcceptPlanningCommitmentRequestSchema,
  AcceptPlanningCommitmentResponseSchema, ExecutePlanningJobRequestSchema, ExecutePlanningJobResponseSchema } from '../../generated/ts/glimmer/cognition/v1/cognition_service_pb';
import { GetPlanningJobAdmissionRequestSchema, GetPlanningJobAdmissionResponseSchema } from '../../generated/ts/glimmer/cognition/v1/cognition_service_pb';
import { PublishPlanningJobStateRequestSchema, PublishPlanningJobStateResponseSchema } from '../../generated/ts/glimmer/cognition/v1/cognition_service_pb';
import { PreparePlanningNotificationRequestSchema, PreparePlanningNotificationResponseSchema, GetPreparedPlanningNotificationRequestSchema,
  GetPreparedPlanningNotificationResponseSchema,
  AcknowledgePlanningNotificationRequestSchema, AcknowledgePlanningNotificationResponseSchema,
  PlanningNotificationRequestSchema, ReadPlanningNotificationsRequestSchema, ReadPlanningNotificationsResponseSchema,
  ResolvePlanningNotificationRequestSchema, ResolvePlanningNotificationResponseSchema } from '../../generated/ts/glimmer/cognition/v1/cognition_service_pb';
import {
  AudioPlayEventSchema,
  DeliveryReceiptCommandSchema,
} from '../../generated/ts/glimmer/surface/v1/surface_gateway_pb';

const fixturePath = resolve('fixtures/skill-tool-parameters.valid.json');
const documentBytes = readFileSync(fixturePath);
const document = JSON.parse(documentBytes.toString('utf8')) as { schema_version: string; tool_id: string };
const digest = createHash('sha256').update(documentBytes).digest();

const methodReference = { skillId: 'method:总结', definitionRevision: 'revision:一' };
const nativeScope = { sourceProviderId: 'provider:一', sceneId: 'scene:一', conversationId: 'conversation:一', userId: 'user:一' };
const nativeReference = { id: '["weather","lookup"]', revision: 'revision:一' };
const resourceAccess = { accessId: 'proof:一', sourceId: 'source:一', principalId: 'principal:一', permissionRevision: 'permission:一',
  collectedAtMs: 1n, expiresAtMs: 9007199254740991n };
const nativeMessages = [
  [RegisterKnowledgeResourceSourceRequestSchema, { source: { sourceId: 'source:资料', reference: nativeReference, priority: 9007199254740991n, enabled: false }, expectedSourceRevision: 9007199254740990n }],
  [RegisterKnowledgeResourceSourceResponseSchema, { state: { source: { sourceId: 'source:资料', reference: nativeReference, scope: nativeScope, priority: 1n, enabled: true }, sourceRevision: 1n, declarationDigest: 'a'.repeat(64) } }],
  [GetKnowledgeResourceSourceRequestSchema, { sourceId: 'source:资料' }],
  [GetKnowledgeResourceSourceResponseSchema, {}],
  [CollectKnowledgeSourceRequestSchema, { sourceId: 'source:资料', expectedSourceRevision: 9007199254740991n }],
  [CollectKnowledgeSourceResponseSchema, { sourceId: 'source:资料', sourceRevision: 1n, entryId: 'resource:source:资料', entryRevision: 9007199254740991n, contentDigest: 'b'.repeat(64) }],
  [CollectKnowledgeResourceRequestSchema, { call: { traceId: 'trace:采集', generation: 'generation:一' }, sourceId: 'source:一', reference: nativeReference, scope: nativeScope }],
  [CollectKnowledgeResourceResponseSchema, { content: { reference: nativeReference, contentRevision: 'a'.repeat(64), mediaType: 'text/plain', contentUtf8: '资料' }, access: resourceAccess }],
  [ValidateKnowledgeResourceRequestSchema, { call: { traceId: 'trace:复验' }, access: resourceAccess, reference: nativeReference, contentRevision: 'a'.repeat(64), mediaType: 'text/plain', scope: nativeScope }],
  [ValidateKnowledgeResourceResponseSchema, { current: true }],
  [ExposeStepRequestSchema, { call: { traceId: 'trace:一', generation: 'generation:一' }, runId: 'run:一', step: 2,
    scope: nativeScope, protocolFeatures: ['tool-call.v1'], maxDefinitions: 128, maxDefinitionBytes: 65536, remainingToolCalls: 7 }],
  [ExposeStepResponseSchema, { runId: 'run:一', step: 2, tools: [{ reference: nativeReference, name: 'tool_weather', inputSchema: fromJson(ValueSchema, true) }],
    skills: [{ reference: methodReference, name: '总结', inputSchema: fromJson(ValueSchema, { type: 'object', required: ['topic'] }) }], resources: [{ reference: nativeReference, name: 'resource', inputSchema: fromJson(ValueSchema, { type: 'object' }) }], usedDefinitionBytes: 123, truncated: true }],
  [InvokeToolRequestSchema, { call: { idempotencyKey: 'run:一:call:一' }, runId: 'run:一', step: 2, callId: 'call:一', name: 'tool_weather',
    reference: nativeReference, scope: nativeScope, arguments: { city: '上海' }, sourceFactId: 'action:一' }],
  [InvokeToolResponseSchema, { callId: 'call:一', name: 'tool_weather', state: ExecutionResultState.SUCCEEDED,
    result: fromJson(ValueSchema, null), resultEventId: 'a'.repeat(64) }],
  [ReadCapabilityRequestSchema, { call: { idempotencyKey: 'run:一:read:一' }, runId: 'run:一', step: 2, callId: 'read:一', name: 'glimmer_load_skill',
    reference: nativeReference, scope: nativeScope, arguments: { topic: '资料' }, sourceFactId: 'action:加载' }],
  [ReadCapabilityResponseSchema, { callId: 'read:一', name: 'glimmer_load_skill', state: ExecutionResultState.SUCCEEDED, resultEventId: 'b'.repeat(64),
    content: { case: 'skill', value: { reference: methodReference, instructions: '真实正文\n不是权限。' } } }],
  [ReadCapabilityResponseSchema, { callId: 'read:二', name: 'glimmer_read_resource', state: ExecutionResultState.SUCCEEDED, resultEventId: 'c'.repeat(64),
    content: { case: 'resource', value: { reference: nativeReference, contentRevision: createHash('sha256').update('资源').digest('hex'), mediaType: 'text/plain', contentUtf8: '资源' } } }],
  [ReadCapabilityResponseSchema, { callId: 'read:三', state: ExecutionResultState.FAILED, error: 'authorization_denied', resultEventId: 'd'.repeat(64) }],
] as const;
if (fromBinary(KnowledgeResourceSourceSchema, new Uint8Array()).enabled !== undefined
  || fromBinary(GetKnowledgeResourceSourceResponseSchema, new Uint8Array()).state !== undefined) throw new Error('Knowledge absent field gained presence');
for (const [schema, input] of nativeMessages) {
  const message = create(schema as typeof ExposeStepRequestSchema, input as never);
  const restored = fromBinary(schema as typeof ExposeStepRequestSchema, toBinary(schema as typeof ExposeStepRequestSchema, message));
  if (toJsonString(schema as typeof ExposeStepRequestSchema, message) !== toJsonString(schema as typeof ExposeStepRequestSchema, restored))
    throw new Error('Native capability Step/reference/privacy/null roundtrip failed');
}
if (fromBinary(ExposeStepRequestSchema, new Uint8Array()).scope !== undefined) throw new Error('Absent native scope gained presence');
if (fromBinary(CollectKnowledgeResourceResponseSchema, new Uint8Array()).access !== undefined) throw new Error('Absent collection gained access evidence');
if (fromBinary(ReadCapabilityResponseSchema, new Uint8Array()).content.case !== undefined) throw new Error('Absent read gained content');
for (const [schema, input] of [[ReadSkillRequestSchema, { request: { callId: '加载:一', sourceFactId: 'action:加载', reference: nativeReference } }],
  [ReadResourceRequestSchema, { request: { callId: '资源:一', scope: nativeScope, reference: nativeReference } }],
  [ReadSkillResponseSchema, { result: { content: { case: 'skill', value: { reference: methodReference, instructions: '方法' } } } }],
  [ReadResourceResponseSchema, { result: { content: { case: 'resource', value: { reference: nativeReference, contentUtf8: '资源' } } } }]] as const) {
  const message = create(schema as typeof ReadSkillRequestSchema, input as never);
  if (toJsonString(schema as typeof ReadSkillRequestSchema, fromBinary(schema as typeof ReadSkillRequestSchema, toBinary(schema as typeof ReadSkillRequestSchema, message)))
      !== toJsonString(schema as typeof ReadSkillRequestSchema, message)) throw new Error('Read service envelope roundtrip failed');
}
const methodPlan = create(PlanRequestSchema, { userGoal: '原始目标',
  availableSkills: [{ reference: methodReference, name: '总结', description: '方法知识' }],
  skillMaterials: [{ reference: methodReference, instructions: '参考材料\n不授予权限。' }] });
const restoredMethodPlan = fromBinary(PlanRequestSchema, toBinary(PlanRequestSchema, methodPlan));
if (toJsonString(PlanRequestSchema, methodPlan) !== toJsonString(PlanRequestSchema, restoredMethodPlan)
  || restoredMethodPlan.availableTools.length !== 0) throw new Error('Skill method separate input roundtrip failed');
const methodResponse = create(PlanResponseSchema, { selectedSkills: [methodReference] });
if (toJsonString(PlanResponseSchema, fromBinary(PlanResponseSchema, toBinary(PlanResponseSchema, methodResponse)))
  !== toJsonString(PlanResponseSchema, methodResponse)) throw new Error('Skill reference roundtrip failed');
if (fromBinary(PlanRequestSchema, new Uint8Array()).skillMaterials.length) throw new Error('Legacy plan gained material');

for (const state of [ExecutionResultState.SUCCEEDED, ExecutionResultState.FAILED, ExecutionResultState.UNKNOWN]) {
  const request = create(AcceptExecutionResultRequestSchema, {
    call: { traceId: 'trace:执行', generation: 'generation:1' },
    event: { eventId: 'a'.repeat(64), invocationId: 'invoke:执行', revision: 9007199254740991n,
      attempt: 1, scopeId: 'conversation:范围', conversationId: 'conversation:范围', sourceFactId: 'action:原事实',
      executorId: 'executor', capabilityId: 'tool', definitionRevision: 'definition', requestDigest: 'b'.repeat(64),
      state, sideEffects: state === ExecutionResultState.UNKNOWN ? ExecutionSideEffects.UNKNOWN : ExecutionSideEffects.NONE,
      result: state === ExecutionResultState.SUCCEEDED ? fromJson(ValueSchema, null) : undefined,
      errorCode: state === ExecutionResultState.SUCCEEDED ? '' : 'unconfirmed', updatedAtMs: 1900000000000n },
  });
  const restored = fromBinary(AcceptExecutionResultRequestSchema, toBinary(AcceptExecutionResultRequestSchema, request));
  if (toJsonString(AcceptExecutionResultRequestSchema, restored) !== toJsonString(AcceptExecutionResultRequestSchema, request)
    || (restored.event?.result !== undefined) !== (state === ExecutionResultState.SUCCEEDED)) {
    throw new Error('Execution result identity/Unicode/null presence roundtrip failed');
  }
}
const executionReceipt = create(AcceptExecutionResultResponseSchema, { eventId: 'a'.repeat(64), invocationId: 'invoke:执行',
  revision: 9007199254740991n, momentId: 'moment:事实', logPosition: 9007199254740991n, accepted: true });
if (toJsonString(AcceptExecutionResultResponseSchema, fromBinary(AcceptExecutionResultResponseSchema,
  toBinary(AcceptExecutionResultResponseSchema, executionReceipt))) !== toJsonString(AcceptExecutionResultResponseSchema, executionReceipt)) {
  throw new Error('Execution durable receipt precision roundtrip failed');
}
if (fromBinary(AcceptExecutionResultRequestSchema, new Uint8Array()).event !== undefined) throw new Error('Execution absent event gained presence');

const planningSource = { requestId: createHash('sha256').update(JSON.stringify([
  'planning.evaluate', 'commitment:长期承诺', 'plan:评估', Number.MAX_SAFE_INTEGER,
])).digest('hex'), commitmentId: 'commitment:长期承诺', planId: 'plan:评估',
  planVersion: 9007199254740991n, goalId: 'goal:目标', goalVersion: 9007199254740991n,
  scopeId: 'conversation:范围', dueAtMs: 9007199254740991n };
const planningRead = create(ReadPlanningJobRequestsRequestSchema, {
  call: { traceId: 'trace:planning', generation: 'planning-1' }, limit: 1000,
});
const restoredPlanningRead = fromBinary(ReadPlanningJobRequestsRequestSchema,
  toBinary(ReadPlanningJobRequestsRequestSchema, planningRead));
if (restoredPlanningRead.limit !== 1000 || restoredPlanningRead.call?.generation !== 'planning-1') {
  throw new Error('Planning source read metadata roundtrip failed');
}
const planningResponse = create(ReadPlanningJobRequestsResponseSchema, { requests: [planningSource] });
const restoredPlanning = fromBinary(ReadPlanningJobRequestsResponseSchema,
  toBinary(ReadPlanningJobRequestsResponseSchema, planningResponse)).requests[0];
if (JSON.stringify(restoredPlanning, (_, value) => typeof value === 'bigint' ? String(value) : value)
  !== JSON.stringify(planningResponse.requests[0], (_, value) => typeof value === 'bigint' ? String(value) : value)) {
  throw new Error('Planning source identity/precision roundtrip failed');
}
const planningAck = create(AcknowledgePlanningJobRequestRequestSchema, { call: planningRead.call,
  request: planningSource, jobId: `planning:${planningSource.requestId}`,
  jobRevision: 9007199254740991n, duplicate: true });
const restoredPlanningAck = fromBinary(AcknowledgePlanningJobRequestRequestSchema,
  toBinary(AcknowledgePlanningJobRequestRequestSchema, planningAck));
if (restoredPlanningAck.request?.requestId !== planningSource.requestId
  || restoredPlanningAck.jobRevision !== 9007199254740991n || !restoredPlanningAck.duplicate
  || restoredPlanningAck.jobId !== planningAck.jobId || restoredPlanningAck.call?.generation !== 'planning-1') {
  throw new Error('Planning source ACK precision/metadata roundtrip failed');
}
const planningReceipt = create(AcknowledgePlanningJobRequestResponseSchema, {
  requestId: planningSource.requestId, jobId: planningAck.jobId, accepted: true,
});
const restoredPlanningReceipt = fromBinary(AcknowledgePlanningJobRequestResponseSchema,
  toBinary(AcknowledgePlanningJobRequestResponseSchema, planningReceipt));
if (!restoredPlanningReceipt.accepted || restoredPlanningReceipt.requestId !== planningSource.requestId
  || restoredPlanningReceipt.jobId !== planningAck.jobId) throw new Error('Planning source receipt roundtrip failed');
if (fromBinary(AcknowledgePlanningJobRequestRequestSchema, new Uint8Array()).request !== undefined) {
  throw new Error('Planning source ACK absent request gained presence');
}

const jobIdentity = { jobId: 'job:one', scopeId: 'scope:one', attempt: 2n, authorityEpoch: 7n,
  fencingToken: 9007199254740991n, ownerId: 'host:one', leaseUntilMs: 1900000000000n };
const planningQuery = create(ReconcilePlanningJobRequestSchema, { call: planningRead.call,
  identity: { ...jobIdentity, jobId: planningAck.jobId }, requestId: planningSource.requestId });
const queryRoundtrip = fromBinary(ReconcilePlanningJobRequestSchema, toBinary(ReconcilePlanningJobRequestSchema, planningQuery));
if (queryRoundtrip.identity?.fencingToken !== 9007199254740991n || queryRoundtrip.requestId !== planningSource.requestId) {
  throw new Error('Planning original attempt/request precision roundtrip failed');
}
const planningApplied = create(ReconcilePlanningJobResponseSchema, { result: {
  identity: planningQuery.identity, requestId: planningSource.requestId, resolution: PlanningJobResolution.APPLIED,
  sourceId: 'cognition.planning', receiverFenced: true, evidenceId: 'c'.repeat(64), observedAtMs: 100n,
  receipt: { identity: { ...planningQuery.identity!, attempt: 1n, ownerId: '原提交者' }, receiptId: 'r'.repeat(64),
    requestId: planningSource.requestId, commitmentId: planningSource.commitmentId, commitmentRevision: 9007199254740991n,
    completed: false, reason: '条件尚未满足', committedAtMs: 90n, evidenceIds: ['事实:一'],
    evidence: [{ evidenceId: '事实:一', sourceOwner: 'conversation', scopeId: jobIdentity.scopeId,
      revision: 9007199254740991n, contentDigest: 'a'.repeat(64) }] },
} });
const appliedRoundtrip = fromBinary(ReconcilePlanningJobResponseSchema, toBinary(ReconcilePlanningJobResponseSchema, planningApplied));
if (appliedRoundtrip.result?.receipt?.identity?.attempt !== 1n || appliedRoundtrip.result.receipt.completed
  || appliedRoundtrip.result.receipt.commitmentRevision !== 9007199254740991n
  || appliedRoundtrip.result.receipt.evidence[0].revision !== 9007199254740991n) {
  throw new Error('Planning business receipt/committer precision roundtrip failed');
}
const planningAccept = create(AcceptPlanningCommitmentRequestSchema, { call: planningRead.call,
  commitmentId: '承诺:一', planId: '计划:一', planVersion: 9007199254740991n, goalId: '目标:一',
  goalVersion: 9007199254740991n, text: '核对事实', completionCondition: '真实证据已接纳',
  steps: ['检查实际资料'], sourceMomentId: 'moment:原来源', dueAtMs: 9007199254740991n });
const planningAccepted = create(AcceptPlanningCommitmentResponseSchema, { commitmentId: planningAccept.commitmentId,
  planId: planningAccept.planId, planVersion: planningAccept.planVersion, revision: 9007199254740991n,
  status: 'accepted', scopeId: 'conversation:一' });
const planningExecute = create(ExecutePlanningJobRequestSchema, { call: planningRead.call,
  identity: planningQuery.identity, requestId: planningSource.requestId });
const admissionRequest = create(GetPlanningJobAdmissionRequestSchema, { call: planningRead.call,
  jobId: planningQuery.identity!.jobId, scopeId: 'conversation:一', requestId: planningSource.requestId });
const admissionResponse = create(GetPlanningJobAdmissionResponseSchema, { jobId: admissionRequest.jobId,
  scopeId: admissionRequest.scopeId, requestId: admissionRequest.requestId, eligible: false, reasonCode: 'planning_model_policy' });
if (fromBinary(GetPlanningJobAdmissionRequestSchema, toBinary(GetPlanningJobAdmissionRequestSchema, admissionRequest)).call?.generation !== 'planning-1'
  || fromBinary(GetPlanningJobAdmissionResponseSchema, toBinary(GetPlanningJobAdmissionResponseSchema, admissionResponse)).eligible
  || fromBinary(GetPlanningJobAdmissionResponseSchema, toBinary(GetPlanningJobAdmissionResponseSchema, admissionResponse)).reasonCode !== 'planning_model_policy') {
  throw new Error('Planning read-only admission identity/policy roundtrip failed');
}
const planningExecuted = create(ExecutePlanningJobResponseSchema, { result: planningApplied.result });
if (fromBinary(AcceptPlanningCommitmentRequestSchema, toBinary(AcceptPlanningCommitmentRequestSchema, planningAccept)).sourceMomentId !== 'moment:原来源'
  || fromBinary(AcceptPlanningCommitmentRequestSchema, toBinary(AcceptPlanningCommitmentRequestSchema, planningAccept)).goalVersion !== 9007199254740991n
  || fromBinary(AcceptPlanningCommitmentResponseSchema, toBinary(AcceptPlanningCommitmentResponseSchema, planningAccepted)).revision !== 9007199254740991n
  || fromBinary(ExecutePlanningJobRequestSchema, toBinary(ExecutePlanningJobRequestSchema, planningExecute)).identity?.fencingToken !== 9007199254740991n
  || fromBinary(ExecutePlanningJobResponseSchema, toBinary(ExecutePlanningJobResponseSchema, planningExecuted)).result?.receipt?.completed !== false
  || fromBinary(ExecutePlanningJobResponseSchema, new Uint8Array()).result !== undefined) {
  throw new Error('Planning accept/execute source/precision/presence roundtrip failed');
}
const notification = create(PlanningNotificationRequestSchema, { notificationId: 'd'.repeat(64), receiptId: 'e'.repeat(64),
  requestId: planningSource.requestId, jobId: planningAck.jobId, commitmentId: planningSource.commitmentId,
  commitmentRevision: 9007199254740991n, goalId: planningSource.goalId, goalVersion: 9007199254740991n,
  scopeId: planningSource.scopeId, sourceMomentId: 'moment:原来源', sourceDigest: 'a'.repeat(64), createdAtMs: 0n });
const notificationRead = create(ReadPlanningNotificationsRequestSchema, { limit: 1, afterNotificationId: 'b'.repeat(64) });
const notificationPage = create(ReadPlanningNotificationsResponseSchema, { requests: [notification] });
const notificationResolve = create(ResolvePlanningNotificationRequestSchema, { request: notification });
const notificationResolved = create(ResolvePlanningNotificationResponseSchema, { request: notification, available: true,
  reasonCode: 'planning_notification_source_ready', goalText: '目标:一', actorId: 'actor:一', privacyClass: 'private',
  recallOwnerId: 'actor:一', disclosureOwnerId: 'conversation:一',
  context: { sourceProviderId: 'provider:一', sceneId: 'scene:一', conversationId: 'conversation:一', continuityId: 'continuity:一',
    threadId: 'main', interactionId: 'interaction:一', recallScope: 'actor_private', disclosureScope: 'conversation_private' },
  receipt: { ...planningApplied.result!.receipt!, completed: true } });
const notificationRestored = fromBinary(ResolvePlanningNotificationResponseSchema, toBinary(ResolvePlanningNotificationResponseSchema, notificationResolved));
const notificationPrepare = create(PreparePlanningNotificationRequestSchema, { request: notification });
const notificationHistory = create(GetPreparedPlanningNotificationRequestSchema, { request: notification });
if (fromBinary(GetPreparedPlanningNotificationRequestSchema, toBinary(GetPreparedPlanningNotificationRequestSchema, notificationHistory)).request?.goalVersion !== 9007199254740991n
  || fromBinary(GetPreparedPlanningNotificationRequestSchema, new Uint8Array()).request !== undefined) throw new Error('Planning notification historical query precision/presence failed');
const notificationPrepared = create(PreparePlanningNotificationResponseSchema, { request: notification, accepted: true,
  turnId: 'turn:通知', turnRevision: 9007199254740991n, replyMomentId: 'reply:通知', logPosition: 9007199254740991n,
  contentDigest: 'f'.repeat(64), context: notificationResolved.context, actorId: 'actor:一', privacyClass: 'private',
  recallOwnerId: 'actor:一', disclosureOwnerId: 'conversation:一', text: '根据真实证据形成的通知。' });
const preparedRoundtrip = fromBinary(PreparePlanningNotificationResponseSchema, toBinary(PreparePlanningNotificationResponseSchema, notificationPrepared));
const historicalIdentity = create(GetPreparedPlanningNotificationResponseSchema, { original: { ...notificationPrepared, text: '' } });
if (fromBinary(GetPreparedPlanningNotificationResponseSchema, toBinary(GetPreparedPlanningNotificationResponseSchema, historicalIdentity)).original?.logPosition !== 9007199254740991n
  || fromBinary(GetPreparedPlanningNotificationResponseSchema, new Uint8Array()).original !== undefined) throw new Error('Planning historical identity precision/presence failed');
const notificationAck = create(AcknowledgePlanningNotificationRequestSchema, { request: notification, confirmation: {
  turnId: notificationPrepared.turnId, replyMomentId: notificationPrepared.replyMomentId,
  logPosition: 9007199254740991n, contentDigest: notificationPrepared.contentDigest,
  receipt: { outputId: 'reply:通知', destinationId: 'scene:一', authorityEpoch: 'epoch:一', generation: 9007199254740991n,
    receiptId: 'receipt:一', kind: 'playback_completed', heardThroughMs: 125n, durationMs: 300n, receivedAt: '2026-10-08T00:00:00Z' } } });
const ackRoundtrip = fromBinary(AcknowledgePlanningNotificationRequestSchema, toBinary(AcknowledgePlanningNotificationRequestSchema, notificationAck));
const notificationAckResponse = create(AcknowledgePlanningNotificationResponseSchema, { notificationId: notification.notificationId, accepted: true });
if (ackRoundtrip.confirmation?.receipt?.generation !== 9007199254740991n || ackRoundtrip.confirmation?.logPosition !== 9007199254740991n
  || ackRoundtrip.confirmation?.receipt?.durationMs !== 300n || ackRoundtrip.confirmation?.receipt?.receiptId !== 'receipt:一'
  || !fromBinary(AcknowledgePlanningNotificationResponseSchema, toBinary(AcknowledgePlanningNotificationResponseSchema, notificationAckResponse)).accepted
  || fromBinary(AcknowledgePlanningNotificationRequestSchema, new Uint8Array()).confirmation !== undefined) {
  throw new Error('Planning notification full Delivery confirmation/precision/presence roundtrip failed');
}
if (fromBinary(PreparePlanningNotificationRequestSchema, toBinary(PreparePlanningNotificationRequestSchema, notificationPrepare)).request?.notificationId !== notification.notificationId
  || preparedRoundtrip.logPosition !== 9007199254740991n || preparedRoundtrip.turnRevision !== 9007199254740991n
  || !preparedRoundtrip.accepted || preparedRoundtrip.text !== notificationPrepared.text || preparedRoundtrip.contentDigest !== 'f'.repeat(64)
  || preparedRoundtrip.context?.recallScope !== 'actor_private' || preparedRoundtrip.disclosureOwnerId !== 'conversation:一'
  || fromBinary(PreparePlanningNotificationResponseSchema, new Uint8Array()).actorId !== undefined) {
  throw new Error('Planning notification accepted Reply/Turn/digest/precision/presence roundtrip failed');
}
if (fromBinary(PlanningNotificationRequestSchema, toBinary(PlanningNotificationRequestSchema, notification)).goalVersion !== 9007199254740991n
  || fromBinary(ReadPlanningNotificationsRequestSchema, toBinary(ReadPlanningNotificationsRequestSchema, notificationRead)).afterNotificationId !== 'b'.repeat(64)
  || fromBinary(ReadPlanningNotificationsResponseSchema, toBinary(ReadPlanningNotificationsResponseSchema, notificationPage)).requests[0].createdAtMs !== 0n
  || fromBinary(ResolvePlanningNotificationRequestSchema, toBinary(ResolvePlanningNotificationRequestSchema, notificationResolve)).request?.sourceMomentId !== 'moment:原来源'
  || !notificationRestored.receipt?.completed || notificationRestored.recallOwnerId !== 'actor:一'
  || fromBinary(ResolvePlanningNotificationResponseSchema, new Uint8Array()).context !== undefined
  || fromBinary(PlanningNotificationRequestSchema, new Uint8Array()).sourceMomentId !== undefined) {
  throw new Error('Planning notification context/receipt/precision/presence roundtrip failed');
}
planningApplied.result!.resolution = PlanningJobResolution.NOT_APPLIED;
planningApplied.result!.receipt = undefined;
if (fromBinary(ReconcilePlanningJobResponseSchema, toBinary(ReconcilePlanningJobResponseSchema, planningApplied)).result?.receipt !== undefined) {
  throw new Error('Planning negative result gained receipt presence');
}
const stateRequest = create(PublishMemoryJobStateRequestSchema, { deliveryAuthorityEpoch: 9007199254740991n,
  event: { eventId: 'event:one', jobId: 'job:one', scopeId: 'scope:one', goalId: 'source:one', kind: 'memory.consolidate',
    revision: 9007199254740991n, status: JobStatus.CANCELLED, attempt: 2n, authorityEpoch: 7n, fencingToken: 8n,
    updatedAtMs: 1900000000000n, errorCode: 'cancelled' } });
const restoredState = fromBinary(PublishMemoryJobStateRequestSchema, toBinary(PublishMemoryJobStateRequestSchema, stateRequest));
const planningState = create(PublishPlanningJobStateRequestSchema, { deliveryAuthorityEpoch: 9007199254740991n,
  event: { ...stateRequest.event!, kind: 'planning.evaluate', result: { assessment: { completed: false } } } });
const planningStateAck = create(PublishPlanningJobStateResponseSchema, { eventId: 'event:one', accepted: true, duplicate: true });
const restoredPlanningState = fromBinary(PublishPlanningJobStateRequestSchema, toBinary(PublishPlanningJobStateRequestSchema, planningState));
if (restoredPlanningState.deliveryAuthorityEpoch !== 9007199254740991n || restoredPlanningState.event?.revision !== 9007199254740991n
  || (restoredPlanningState.event.result?.assessment as { completed: boolean }).completed !== false
  || !fromBinary(PublishPlanningJobStateResponseSchema, toBinary(PublishPlanningJobStateResponseSchema, planningStateAck)).duplicate
  || fromBinary(PublishPlanningJobStateRequestSchema, new Uint8Array()).event !== undefined) {
  throw new Error('Planning state precision/completed=false/ACK/presence roundtrip failed');
}
if (restoredState.deliveryAuthorityEpoch !== 9007199254740991n || restoredState.event?.revision !== 9007199254740991n
  || restoredState.event.status !== JobStatus.CANCELLED || restoredState.event.result !== undefined
  || restoredState.event.errorCode !== 'cancelled') throw new Error('Job state precision/presence roundtrip failed');
stateRequest.event!.result = { receipt_id: 'receipt:one', memory_ids: ['memory:one'] };
if (fromBinary(PublishMemoryJobStateRequestSchema, toBinary(PublishMemoryJobStateRequestSchema, stateRequest)).event?.result?.receipt_id !== 'receipt:one') {
  throw new Error('Job state result roundtrip failed');
}
const sourceAck = create(AcknowledgeMemoryJobRequestRequestSchema, { jobId: 'job:one', request: {
  requestId: 'source:one', episodeId: 'episode:one', episodeVersion: 9007199254740991n,
  scopeId: 'scope:one', inputDigest: 'a'.repeat(64), createdAt: '2026-10-06T00:00:00Z' } });
if (fromBinary(AcknowledgeMemoryJobRequestRequestSchema, toBinary(AcknowledgeMemoryJobRequestRequestSchema, sourceAck))
  .request?.episodeVersion !== 9007199254740991n) throw new Error('Memory source request roundtrip failed');
const memoryRequest = create(ExecuteMemoryJobRequestSchema, { identity: jobIdentity,
  episodeId: 'episode:one', episodeVersion: 3n, inputDigest: 'a'.repeat(64) });
const restoredMemoryRequest = fromBinary(ExecuteMemoryJobRequestSchema, toBinary(ExecuteMemoryJobRequestSchema, memoryRequest));
if (restoredMemoryRequest.identity?.fencingToken !== jobIdentity.fencingToken || restoredMemoryRequest.episodeVersion !== 3n) {
  throw new Error('Memory Job original identity round-trip lost precision');
}
const sealedJob = create(ReconcileMemoryJobResponseSchema, { result: { identity: jobIdentity,
  resolution: MemoryJobResolution.NOT_APPLIED, receiverFenced: true, evidenceId: 'sealed', sourceId: 'cognition.memory' } });
if (!fromBinary(ReconcileMemoryJobResponseSchema, toBinary(ReconcileMemoryJobResponseSchema, sealedJob)).result?.receiverFenced) {
  throw new Error('Memory Job sealed proof round-trip lost fencing');
}

const asset = { assetId: '00000000-0000-4000-8000-000000000001', mediaType: 'image/png',
  sizeBytes: 3n, sha256: 'a'.repeat(64) };
const contentParts = [
  create(ContentPartSchema, { value: { case: 'text', value: 'hello' } }),
  create(ContentPartSchema, { value: { case: 'image', value: asset } }),
  create(ContentPartSchema, { value: { case: 'audio', value: { ...asset, mediaType: 'audio/wav' } } }),
  create(ContentPartSchema, { value: { case: 'video', value: { ...asset, mediaType: 'video/mp4' } } }),
  create(ContentPartSchema, { value: { case: 'file', value: { asset, name: 'a.png' } } }),
];
if (contentParts.map((part) => fromBinary(ContentPartSchema, toBinary(ContentPartSchema, part)).value.case).join(',')
  !== 'text,image,audio,video,file') {
  throw new Error('TypeScript ContentPart round-trip lost a variant');
}

const request = create(EchoProbeRequestSchema, {
  probeId: 'slice1-contract-probe',
  document: {
    documentId: document.tool_id,
    schemaId: 'https://glimmer-cradle.local/contracts/skill/v1/tool-parameters.schema.json',
    schemaVersion: document.schema_version,
    digestSha256: digest,
  },
  trace: {
    traceId: 'trace-contracts-slice-1',
    causationId: 'm12-slice-1',
    correlationId: 'parent-019f9407-0503-7613-a386-024a5ad5d619',
  },
});

const requestRoundTrip = fromBinary(EchoProbeRequestSchema, toBinary(EchoProbeRequestSchema, request));
if (requestRoundTrip.document?.documentId !== document.tool_id) {
  throw new Error('TypeScript request protobuf round-trip lost the document reference');
}

const response = create(EchoProbeResponseSchema, {
  probeId: requestRoundTrip.probeId,
  document: requestRoundTrip.document,
});
const responseRoundTrip = fromBinary(EchoProbeResponseSchema, toBinary(EchoProbeResponseSchema, response));
if (
  responseRoundTrip.probeId !== request.probeId
  || responseRoundTrip.document?.schemaVersion !== document.schema_version
) {
  throw new Error('TypeScript response protobuf round-trip lost the successful echo result');
}


const avatarFrame = create(AvatarDownstreamFrameSchema, {
  kind: 'avatar_intent',
  traceId: 'trace-avatar-contract',
  timestamp: 42,
  avatarIntent: {
    actionId: 'wave-hand',
    operation: 'trigger',
    source: 'user',
    priority: 7,
  },
});
const avatarJson = toJsonString(AvatarDownstreamFrameSchema, avatarFrame, {
  useProtoFieldName: true,
});
if (
  !avatarJson.includes('"trace_id"')
  || !avatarJson.includes('"avatar_intent"')
  || !avatarJson.includes('"action_id"')
  || avatarJson.includes('traceId')
  || avatarJson.includes('avatarIntent')
) {
  throw new Error('TypeScript Avatar JSON projection did not preserve published snake_case wire names');
}
const avatarJsonRoundTrip = fromJsonString(AvatarDownstreamFrameSchema, avatarJson);
if (avatarJsonRoundTrip.avatarIntent?.actionId !== 'wave-hand'
    || avatarJsonRoundTrip.avatarIntent.priority !== 7) {
  throw new Error('TypeScript Avatar JSON round-trip lost the control payload');
}

const receipt = create(DeliveryReceiptCommandSchema, {
  outputId: 'reply:trace', destinationId: 'surface:desktop', authorityEpoch: 'epoch:test',
  generation: 3n, receiptId: 'receipt:test', kind: 'playback_progress',
  heardThroughMs: 125n, durationMs: 500n, receivedAt: '2026-09-22T00:00:00Z',
});
const receiptRoundTrip = fromBinary(
  DeliveryReceiptCommandSchema,
  toBinary(DeliveryReceiptCommandSchema, receipt),
);
if (receiptRoundTrip.generation !== 3n || receiptRoundTrip.heardThroughMs !== 125n) {
  throw new Error('TypeScript Surface delivery receipt round-trip lost fencing or progress');
}
const audioPlay = create(AudioPlayEventSchema, {
  audioId: 'audio:1', outputId: 'reply:trace', destinationId: 'surface:desktop',
  authorityEpoch: 'epoch:test', generation: 3n, segmentIndex: 1, segmentCount: 2,
});
const audioPlayRoundTrip = fromBinary(AudioPlayEventSchema, toBinary(AudioPlayEventSchema, audioPlay));
if (audioPlayRoundTrip.segmentIndex !== 1 || audioPlayRoundTrip.segmentCount !== 2) {
  throw new Error('TypeScript Surface audio segment round-trip lost ordering metadata');
}

console.log('contracts roundtrip ts: ok');
