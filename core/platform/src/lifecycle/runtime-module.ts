import type { TraceContext } from '../observability/index.js';

/** Optional startup evidence; each owner defines the fields it emits. */
export interface RuntimeModuleStartDetails extends Record<string, unknown> {}

/** A supervised unit. stop must also release resources acquired by a failed start. */
export interface RuntimeModule {
  readonly name: string;
  start(context: TraceContext): Promise<RuntimeModuleStartDetails | void> | RuntimeModuleStartDetails | void;
  stop(context: TraceContext): Promise<void> | void;
}

export interface LifecyclePhase {
  readonly name: string;
  readonly modules: readonly RuntimeModule[];
  readonly mode?: 'serial' | 'parallel';
}

export interface LifecycleStartupRecord {
  readonly phase: string;
  readonly moduleName: string;
  readonly startupTimeMs: number;
  readonly details?: RuntimeModuleStartDetails;
}

export interface LifecycleObserver {
  phaseStarting?(phase: LifecyclePhase): Promise<void> | void;
  phaseStarted?(phase: LifecyclePhase): Promise<void> | void;
  moduleStarted?(record: LifecycleStartupRecord, context: TraceContext): Promise<void> | void;
  moduleStopped?(module: RuntimeModule, context: TraceContext): Promise<void> | void;
}
