import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  EchoProbeRequestSchema,
  EchoProbeResponseSchema,
} from '../../generated/ts/glimmer/common/v1/contract_probe_pb';

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

console.log('contracts roundtrip ts: ok');
