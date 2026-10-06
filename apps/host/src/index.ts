export { CognitionJobAdapter } from './composition/cognition-job-adapter.js';
export { CognitionClient, HostCognitionError } from './adapters/protocol/cognition-client.js';
export type { MemoryJobsCognitionPort } from './adapters/protocol/cognition-client.js';
export { MEMORY_JOB_KIND, memoryJobRequest, memoryJobIdentity, memoryJobEvidence } from './adapters/protocol/job-mapper.js';
export type { MemoryJobSubmissionPolicy } from './adapters/protocol/job-mapper.js';
