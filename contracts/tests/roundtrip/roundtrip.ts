import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { create, fromBinary, fromJson, fromJsonString, toBinary, toJsonString } from '@bufbuild/protobuf';
import { ValueSchema } from '@bufbuild/protobuf/wkt';
import { ExecutionResultState, ExecutionSideEffects } from '../../generated/ts/glimmer/capabilities/v1/capabilities_pb';
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
import { PublishMemoryJobStateRequestSchema } from '../../generated/ts/glimmer/cognition/v1/cognition_service_pb';
import { ExecuteMemoryJobRequestSchema, ReconcileMemoryJobResponseSchema, MemoryJobResolution,
  AcknowledgeMemoryJobRequestRequestSchema, ReadPlanningJobRequestsRequestSchema,
  ReadPlanningJobRequestsResponseSchema, AcknowledgePlanningJobRequestRequestSchema,
  AcknowledgePlanningJobRequestResponseSchema } from '../../generated/ts/glimmer/cognition/v1/cognition_service_pb';
import {
  AudioPlayEventSchema,
  DeliveryReceiptCommandSchema,
} from '../../generated/ts/glimmer/surface/v1/surface_gateway_pb';

const fixturePath = resolve('fixtures/skill-tool-parameters.valid.json');
const documentBytes = readFileSync(fixturePath);
const document = JSON.parse(documentBytes.toString('utf8')) as { schema_version: string; tool_id: string };
const digest = createHash('sha256').update(documentBytes).digest();

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
const stateRequest = create(PublishMemoryJobStateRequestSchema, { deliveryAuthorityEpoch: 9007199254740991n,
  event: { eventId: 'event:one', jobId: 'job:one', scopeId: 'scope:one', goalId: 'source:one', kind: 'memory.consolidate',
    revision: 9007199254740991n, status: JobStatus.CANCELLED, attempt: 2n, authorityEpoch: 7n, fencingToken: 8n,
    updatedAtMs: 1900000000000n, errorCode: 'cancelled' } });
const restoredState = fromBinary(PublishMemoryJobStateRequestSchema, toBinary(PublishMemoryJobStateRequestSchema, stateRequest));
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
