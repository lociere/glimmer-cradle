import type { TraceContext } from '../observability/index.js';
import type { Clock } from '../time/index.js';

/** Optional startup evidence; each owner defines the fields it emits. */
export interface RuntimeModuleStartDetails extends Record<string, unknown> {}

/** A unit supervised by a composition root. */
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

/**
 * Owns generic module ordering only. Readiness, product events, and domain
 * projections remain with the composition layer through LifecycleObserver.
 */
export class LifecycleCoordinator {
  private readonly startedModules: RuntimeModule[] = [];
  private readonly startupRecords: LifecycleStartupRecord[] = [];

  public constructor(
    private readonly clock: Pick<Clock, 'monotonicNowMs'>,
    private readonly observer: LifecycleObserver = {},
  ) {}

  public get started(): readonly RuntimeModule[] {
    return [...this.startedModules];
  }

  public get startupReport(): readonly LifecycleStartupRecord[] {
    return [...this.startupRecords];
  }

  public async startPhase(phase: LifecyclePhase, context: TraceContext): Promise<void> {
    await this.observer.phaseStarting?.(phase);
    if (phase.mode === 'parallel') {
      const results = await Promise.allSettled(
        phase.modules.map((module) => this.startModule(phase.name, module, context)),
      );
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failures.length === 1) throw failures[0].reason;
      if (failures.length > 1) {
        throw new AggregateError(failures.map((failure) => failure.reason), `生命周期阶段 ${phase.name} 启动失败`);
      }
    } else {
      for (const module of phase.modules) await this.startModule(phase.name, module, context);
    }
    await this.observer.phaseStarted?.(phase);
  }

  private async startModule(phase: string, module: RuntimeModule, context: TraceContext): Promise<void> {
    const startedAt = this.clock.monotonicNowMs();
    const details = await module.start(context);
    const record: LifecycleStartupRecord = {
      phase,
      moduleName: module.name,
      startupTimeMs: Math.max(0, this.clock.monotonicNowMs() - startedAt),
      ...(details && Object.keys(details).length > 0 ? { details } : {}),
    };
    this.startedModules.push(module);
    this.startupRecords.push(record);
    await this.observer.moduleStarted?.(record, context);
  }

  public async stopStarted(context: TraceContext): Promise<void> {
    try {
      for (const module of [...this.startedModules].reverse()) {
        await module.stop(context);
        await this.observer.moduleStopped?.(module, context);
      }
    } finally {
      this.startedModules.length = 0;
      this.startupRecords.length = 0;
    }
  }
}
