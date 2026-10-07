export { GLOBAL_CAPABILITY_SCOPE, isCapabilityScopeVisible } from './exposure/exposure-policy.js';
export type { CapabilityScope, CapabilityScopeContext } from './exposure/exposure-policy.js';
export { ExecutionController } from './execution/execution-controller.js';
export { SqliteExecutionJournal } from './adapters/storage/sqlite-execution-journal.js';
export { executionDigest, ExecutionConflictError, ExecutionRecoveryRequiredError } from './execution/invocation.js';
export type { Invocation, InvocationRequest, ExecutionState, ExecutionTarget } from './execution/invocation.js';
export type { ExecutionJournal } from './execution/execution-journal.js';
export type { ExecutorPort, ExecutionOutcome } from './execution/executor-port.js';
export type { ExecutionResultEvent, ExecutionResultReceipt } from './execution/result-outbox.js';
