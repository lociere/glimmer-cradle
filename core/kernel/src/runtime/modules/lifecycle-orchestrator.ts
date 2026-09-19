/**
 * Kernel 生命周期编排器。
 *
 * App 只声明阶段计划；本文件负责统一启动、停机、耗时记录和主时间线日志。
 * 这样 Kernel 作为中枢表达“我确认哪些 runtime 已就绪”，各 runtime delegate
 * 只负责自己的组装细节，不再各自抢着宣布全局启动成功。
 */
import { ModuleStartedEvent, ModuleStoppedEvent } from '../../domain/events';
import type { TraceContext } from '../../domain/kernel-contracts';
import type { KernelEventBusPort } from '../../ports/event-bus.port';
import type { Logger as KernelLoggerPort } from '@glimmer-cradle/platform/observability';
import type { Clock as KernelClockPort } from '@glimmer-cradle/platform/time';
import type { RuntimeProjectionInputPort } from '../../ports/kernel-lifecycle.port';
import {
  normalizeRuntimeReadiness,
  strongestRuntimeReadinessState,
  summarizeRuntimeReadiness,
} from '../../ports/runtime-readiness.port';
import {
  LifecycleCoordinator,
  type LifecyclePhase,
  type LifecycleStartupRecord,
  type RuntimeModule,
} from '@glimmer-cradle/platform/lifecycle';

export type RuntimePhase = LifecyclePhase;

export interface RuntimeStartupRecord {
  readonly phase: string;
  readonly runtime_module: string;
  readonly startup_time_ms: number;
  readonly details?: Record<string, unknown>;
}

export class LifecycleOrchestrator {
  private readonly coordinator: LifecycleCoordinator;

  public constructor(
    private readonly logger: KernelLoggerPort,
    private readonly eventBus: KernelEventBusPort,
    private readonly projection: RuntimeProjectionInputPort,
    clock: Pick<KernelClockPort, 'monotonicNowMs'>,
  ) {
    this.coordinator = new LifecycleCoordinator(clock, {
      phaseStarting: (phase) => this.logPhaseStarting(phase),
      phaseStarted: (phase) => this.logPhaseStarted(phase),
      moduleStarted: (record, context) => this.acceptModuleStarted(record, context),
      moduleStopped: (module, context) => this.acceptModuleStopped(module, context),
    });
  }

  public get started(): RuntimeModule[] {
    return [...this.coordinator.started];
  }

  public get startupReport(): RuntimeStartupRecord[] {
    return this.coordinator.startupReport.map((record) => ({
      phase: record.phase,
      runtime_module: record.moduleName,
      startup_time_ms: record.startupTimeMs,
      details: record.details,
    }));
  }

  public async startPhase(phase: RuntimePhase, context: TraceContext): Promise<void> {
    await this.coordinator.startPhase(phase, context);
  }

  private logPhaseStarting(phase: RuntimePhase): void {
    this.logger.info('启动阶段开始', {
      phase: phase.name,
      modules: phase.modules.map((module) => module.name),
      mode: phase.mode ?? 'serial',
    });

  }

  private logPhaseStarted(phase: RuntimePhase): void {
    this.logger.info('启动阶段完成', {
      phase: phase.name,
      module_count: phase.modules.length,
    });
  }

  private async acceptModuleStarted(record: LifecycleStartupRecord, context: TraceContext): Promise<void> {
    await this.eventBus.publish(new ModuleStartedEvent({
      moduleName: record.moduleName,
      startupTimeMs: record.startupTimeMs,
    }, context));

    const snapshots = normalizeRuntimeReadiness(record.details?.runtime_readiness)
      .map((snapshot) => ({
        ...snapshot,
        duration_ms: snapshot.duration_ms ?? record.startupTimeMs,
      }));
    this.projection.replaceModuleSnapshots(record.moduleName, snapshots);
    const readiness = summarizeRuntimeReadiness(snapshots)
      ?? (typeof record.details?.readiness === 'string' ? record.details.readiness : undefined);
    const readinessState = strongestRuntimeReadinessState(snapshots);
    const hasBlockingGate = snapshots.some((snapshot) => snapshot.blocking);
    this.logger.info('启动模块完成', {
      phase: record.phase,
      runtime_module: record.moduleName,
      startup_time_ms: record.startupTimeMs,
      ...(readiness ? { readiness } : {}),
      ...(readinessState ? { status: readinessState } : {}),
      ...(snapshots.length > 0 ? { ready: !snapshots.some((snapshot) => snapshot.state === 'failed') } : {}),
      ...(hasBlockingGate ? { blocking: true } : {}),
    });

    if (record.details && Object.keys(record.details).length > 0) {
      this.logger.debug('启动模块详情', {
        phase: record.phase,
        runtime_module: record.moduleName,
        ...record.details,
      });
    }
  }

  private async acceptModuleStopped(module: RuntimeModule, context: TraceContext): Promise<void> {
    await this.eventBus.publish(new ModuleStoppedEvent({ moduleName: module.name }, context));
    this.logger.info('停止模块完成', { runtime_module: module.name });
  }

  public async stopStarted(context: TraceContext): Promise<void> {
    try {
      await this.coordinator.stopStarted(context);
    } finally {
      this.projection.clear();
    }
  }
}
