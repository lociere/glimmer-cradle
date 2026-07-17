import { EventBus } from '../../foundation/event-bus/event-bus';
import { ModuleStartedEvent, ModuleStoppedEvent } from '../../foundation/event-bus/events';
import type { RuntimeReadinessSnapshot } from '../../foundation/runtime-readiness';
import type { TraceContext } from '@glimmer-cradle/protocol';

export interface RuntimeModuleStartDetails extends Record<string, unknown> {
  readonly readiness?: string;
  readonly runtime_readiness?: RuntimeReadinessSnapshot | RuntimeReadinessSnapshot[];
}

export interface RuntimeModule {
  readonly name: string;
  start(context: TraceContext): Promise<RuntimeModuleStartDetails | void> | RuntimeModuleStartDetails | void;
  stop(context: TraceContext): Promise<void> | void;
}

export interface RuntimeModuleStartResult {
  readonly startupTimeMs: number;
  readonly details?: RuntimeModuleStartDetails;
}

export async function startRuntimeModule(
  module: RuntimeModule,
  context: TraceContext,
): Promise<RuntimeModuleStartResult> {
  const startedAt = Date.now();
  const details = await module.start(context);
  const startupTimeMs = Date.now() - startedAt;
  await EventBus.instance.publish(
    new ModuleStartedEvent({
      moduleName: module.name,
      startupTimeMs,
    }, context),
  );
  return {
    startupTimeMs,
    details: details && Object.keys(details).length > 0 ? details : undefined,
  };
}

export async function stopRuntimeModule(
  module: RuntimeModule,
  context: TraceContext,
): Promise<void> {
  await module.stop(context);
  await EventBus.instance.publish(
    new ModuleStoppedEvent({ moduleName: module.name }, context),
  );
}
