import { ModuleStartedEvent, ModuleStoppedEvent } from '../../domain/events';
import type { RuntimeReadinessSnapshot } from '../../ports/runtime-readiness.port';
import type { TraceContext } from '../../domain/kernel-contracts';
import type { KernelEventBusPort } from '../../ports/event-bus.port';

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
  eventBus: KernelEventBusPort,
): Promise<RuntimeModuleStartResult> {
  const startedAt = Date.now();
  const details = await module.start(context);
  const startupTimeMs = Date.now() - startedAt;
  await eventBus.publish(
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
  eventBus: KernelEventBusPort,
): Promise<void> {
  await module.stop(context);
  await eventBus.publish(
    new ModuleStoppedEvent({ moduleName: module.name }, context),
  );
}
