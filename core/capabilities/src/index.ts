export { GLOBAL_CAPABILITY_SCOPE, isCapabilityScopeVisible, isCapabilityDefinitionVisible } from './exposure/exposure-policy.js';
export type { CapabilityScope, CapabilityScopeContext, CapabilityDefinition } from './exposure/exposure-policy.js';
export { ExposureController } from './exposure/exposure-controller.js';
export type { CapabilityKind, CapabilityReference, ExposureGrant, StepExposureRequest, StepSurface,
  ToolSurfaceDescriptor, ResourceSurfaceDescriptor } from './exposure/step-surface.js';
export { ToolRegistry } from './tools/tool-registry.js';
export type { Tool } from './tools/tool.js';
export { ResourceRegistry } from './resources/resource-registry.js';
export type { Resource } from './resources/resource.js';
export { SkillCatalog } from './skills/skill-catalog.js';
export type { Skill, SkillReference, SkillMaterial, SkillSummary } from './skills/skill.js';
export { ExecutionController } from './execution/execution-controller.js';
export { SqliteExecutionJournal } from './adapters/storage/sqlite-execution-journal.js';
export { executionDigest, ExecutionConflictError, ExecutionRecoveryRequiredError } from './execution/invocation.js';
export type { Invocation, InvocationRequest, ExecutionState, ExecutionTarget } from './execution/invocation.js';
export type { ExecutionJournal, ExecutionResultEvent, ExecutionResultReceipt } from './execution/execution-journal.js';
export type { ExecutorPort, ExecutionOutcome } from './execution/executor-port.js';
export { ExecutionResultOutbox } from './execution/result-outbox.js';
export type { ExecutionResultReceiverPort } from './execution/result-outbox.js';
