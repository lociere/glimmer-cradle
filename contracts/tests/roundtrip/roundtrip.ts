import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { create, fromBinary, fromJsonString, toBinary, toJsonString } from '@bufbuild/protobuf';
import {
  EchoProbeRequestSchema,
  EchoProbeResponseSchema,
} from '../../generated/ts/glimmer/common/v1/contract_probe_pb';
import {
  AvatarDownstreamFrameSchema,
} from '../../generated/ts/glimmer/avatar/v1/avatar_host_pb';

const fixturePath = resolve('fixtures/skill-tool-parameters.valid.json');
const documentBytes = readFileSync(fixturePath);
const document = JSON.parse(documentBytes.toString('utf8')) as { schema_version: string; tool_id: string };
const digest = createHash('sha256').update(documentBytes).digest();

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

console.log('contracts roundtrip ts: ok');
