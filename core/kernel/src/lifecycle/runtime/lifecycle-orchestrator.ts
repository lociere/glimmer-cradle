/**
 * Kernel 生命周期编排器。
 *
 * App 只声明阶段计划；本文件负责统一启动、停机、耗时记录和主时间线日志。
 * 这样 Kernel 作为中枢表达“我确认哪些 runtime 已就绪”，各 runtime delegate
 * 只负责自己的组装细节，不再各自抢着宣布全局启动成功。
 */
import type { TraceContext } from '@glimmer-cradle/protocol';
import { getLogger } from '../../foundation/logger/logger';
import {
  normalizeRuntimeReadiness,
  strongestRuntimeReadinessState,
  summarizeRuntimeReadiness,
} from '../../foundation/runtime-readiness';
import { RuntimeReadinessCatalogStore } from '../../foundation/runtime-readiness-catalog';
import type { RuntimeModule } from './runtime-module';
import { startRuntimeModule, stopRuntimeModule } from './runtime-module';

const logger = getLogger('lifecycle-orchestrator');

export interface RuntimePhase {
  readonly name: string;
  readonly modules: RuntimeModule[];
  readonly mode?: 'serial' | 'parallel';
}

export interface RuntimeStartupRecord {
  readonly phase: string;
  readonly runtime_module: string;
  readonly startup_time_ms: number;
  readonly details?: Record<string, unknown>;
}

export class LifecycleOrchestrator {
  private readonly startedModules: RuntimeModule[] = [];
  private readonly startupRecords: RuntimeStartupRecord[] = [];

  public get started(): RuntimeModule[] {
    return [...this.startedModules];
  }

  public get startupReport(): RuntimeStartupRecord[] {
    return [...this.startupRecords];
  }

  public async startPhase(phase: RuntimePhase, context: TraceContext): Promise<void> {
    logger.info('启动阶段开始', {
      phase: phase.name,
      modules: phase.modules.map((module) => module.name),
      mode: phase.mode ?? 'serial',
    });

    if (phase.mode === 'parallel') {
      await Promise.all(phase.modules.map((module) => this.startModule(phase.name, module, context)));
    } else {
      for (const module of phase.modules) {
        await this.startModule(phase.name, module, context);
      }
    }

    logger.info('启动阶段完成', {
      phase: phase.name,
      module_count: phase.modules.length,
    });
  }

  private async startModule(phase: string, module: RuntimeModule, context: TraceContext): Promise<void> {
    const result = await startRuntimeModule(module, context);
    this.startedModules.push(module);
    this.startupRecords.push({
      phase,
      runtime_module: module.name,
      startup_time_ms: result.startupTimeMs,
      details: result.details,
    });

    const snapshots = normalizeRuntimeReadiness(result.details?.runtime_readiness)
      .map((snapshot) => ({
        ...snapshot,
        duration_ms: snapshot.duration_ms ?? result.startupTimeMs,
      }));
    RuntimeReadinessCatalogStore.instance.replaceModuleSnapshots(module.name, snapshots);
    const readiness = summarizeRuntimeReadiness(snapshots)
      ?? (typeof result.details?.readiness === 'string' ? result.details.readiness : undefined);
    const readinessState = strongestRuntimeReadinessState(snapshots);
    const hasBlockingGate = snapshots.some((snapshot) => snapshot.blocking);
    logger.info('启动模块完成', {
      phase,
      runtime_module: module.name,
      startup_time_ms: result.startupTimeMs,
      ...(readiness ? { readiness } : {}),
      ...(readinessState ? { status: readinessState } : {}),
      ...(snapshots.length > 0 ? { ready: !snapshots.some((snapshot) => snapshot.state === 'failed') } : {}),
      ...(hasBlockingGate ? { blocking: true } : {}),
    });

    if (result.details && Object.keys(result.details).length > 0) {
      logger.debug('启动模块详情', {
        phase,
        runtime_module: module.name,
        ...result.details,
      });
    }
  }

  public async stopStarted(context: TraceContext): Promise<void> {
    for (const module of [...this.startedModules].reverse()) {
      await stopRuntimeModule(module, context);
      logger.info('停止模块完成', { runtime_module: module.name });
    }
    this.startedModules.length = 0;
    this.startupRecords.length = 0;
    RuntimeReadinessCatalogStore.instance.clear();
  }
}
