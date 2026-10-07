import type { CapabilityReference, CapabilityScopeContext, StepExposureRequest, StepSurface } from '@glimmer-cradle/capabilities';

export interface NativeToolInvocation {
  readonly run_id: string;
  readonly step: number;
  readonly call_id: string;
  readonly name: string;
  readonly reference: CapabilityReference;
  readonly scope: CapabilityScopeContext;
  readonly arguments: Record<string, unknown>;
  readonly source_fact_id: string;
  readonly invocation_id: string;
  readonly principal_id: string;
}
export interface NativeToolResult {
  readonly call_id: string;
  readonly name: string;
  readonly state: 'succeeded' | 'failed';
  readonly result?: unknown;
  readonly error?: string;
  readonly result_event_id: string;
}
export interface NativeCapabilityServicePort {
  exposeStep(request: StepExposureRequest): StepSurface;
  invokeTool(request: NativeToolInvocation, traceId: string, signal: AbortSignal): Promise<NativeToolResult>;
  revokePrincipal(principalId: string): void;
}
export class NativeCapabilityRequestError extends Error {}
