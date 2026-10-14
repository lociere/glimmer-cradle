import type { TraceContext } from '../observability/index.js';
import type { Clock } from '../time/clock.js';
import type { LifecycleObserver, LifecyclePhase, LifecycleStartupRecord, RuntimeModule } from './runtime-module.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Deadline } from '../communication/deadline.js';

type StopOutcome = { readonly ok: true } | { readonly ok: false; readonly error: unknown };
type StopRun = { outcome: Promise<StopOutcome>; settled: boolean; consumed: boolean };

export type { LifecycleObserver, LifecyclePhase, LifecycleStartupRecord, RuntimeModule, RuntimeModuleStartDetails } from './runtime-module.js';

/** Tracks active async callbacks, without rejecting external concurrent callers or later descendants. */
export class LifecycleCallbackGuard {
  private readonly scope = new AsyncLocalStorage<{ active: boolean }>();

  public assertExternalCall(): void {
    if (this.scope.getStore()?.active) throw new Error('生命周期回调不能重入所属启动或停止操作，否则会自等待');
  }

  public run<T>(operation: () => T | Promise<T>): Promise<T> {
    const token = { active: true };
    return this.scope.run(token, () => {
      try {
        const result = operation();
        if (result === null || !['object', 'function'].includes(typeof result)
          || typeof (result as { then?: unknown }).then !== 'function') token.active = false;
        return Promise.resolve(result).finally(() => { token.active = false; });
      } catch (error) {
        token.active = false;
        return Promise.reject(error);
      }
    });
  }
}

/** Generic ownership and ordering; readiness and product projections belong to observers. */
export class LifecycleCoordinator {
  private readonly ownedModules: RuntimeModule[] = [];
  private readonly startedModules: RuntimeModule[] = [];
  private readonly startupRecords: LifecycleStartupRecord[] = [];
  private readonly pendingStarts = new Set<Promise<void>>();
  private closing = false;
  private stopping: StopRun | undefined;
  private stopWait: Promise<void> | undefined;
  private readonly callbacks = new LifecycleCallbackGuard();

  public constructor(
    private readonly clock: Pick<Clock, 'monotonicNowMs'>,
    private readonly observer: LifecycleObserver = {},
  ) {}

  public get started(): readonly RuntimeModule[] { return [...this.startedModules]; }
  public get owned(): readonly RuntimeModule[] { return [...this.ownedModules]; }
  public get startupReport(): readonly LifecycleStartupRecord[] { return [...this.startupRecords]; }
  public get hasPendingWork(): boolean { return this.pendingStarts.size > 0 || !!this.stopping && !this.stopping.settled; }
  public get hasRetainedStopOutcome(): boolean { return !!this.stopping && !this.stopping.consumed; }
  public get isClosing(): boolean { return this.closing; }
  public assertExternalCall(): void { this.callbacks.assertExternalCall(); }
  public closeAdmission(): void { this.assertExternalCall(); this.closing = true; }

  public startPhase(phase: LifecyclePhase, context: TraceContext, deadline?: Deadline): Promise<void> {
    try { this.assertExternalCall(); } catch (error) { return Promise.reject(error); }
    if (this.closing) return Promise.reject(new Error('生命周期已关闭，拒绝启动阶段'));
    try {
      if (deadline && deadline.remainingMs <= 0) { this.closing = true; return Promise.reject(new Error('生命周期启动等待预算已到期')); }
    } catch (error) { this.closing = true; return Promise.reject(error); }
    const pending = this.runPhase(phase, context);
    this.pendingStarts.add(pending);
    // Use both handlers so bookkeeping does not create an unobserved rejected promise.
    void pending.then(() => this.pendingStarts.delete(pending), () => this.pendingStarts.delete(pending));
    return deadline ? this.waitForStart(pending, deadline) : pending;
  }

  private async waitForStart(pending: Promise<void>, deadline: Deadline): Promise<void> {
    try {
      if ((await deadline.waitFor(pending)).status === 'expired') throw new Error('生命周期启动等待预算已到期；实际回调仍由原 owner 持有');
    } catch (error) { this.closing = true; throw error; }
  }

  private async runPhase(phase: LifecyclePhase, context: TraceContext): Promise<void> {
    await this.callbacks.run(() => this.observer.phaseStarting?.(phase));
    if (phase.mode === 'parallel') {
      const results = await Promise.allSettled(phase.modules.map(module => this.startModule(phase.name, module, context)));
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      throwFailures(failures.map(result => result.reason), `生命周期阶段 ${phase.name} 启动失败`);
    } else {
      for (const module of phase.modules) await this.startModule(phase.name, module, context);
    }
    if (this.closing) throw new Error('生命周期关闭期间启动阶段被中断');
    await this.callbacks.run(() => this.observer.phaseStarted?.(phase));
  }

  private async startModule(phase: string, module: RuntimeModule, context: TraceContext): Promise<void> {
    if (this.closing) throw new Error('生命周期已关闭，拒绝启动模块');
    if (this.ownedModules.includes(module)) throw new Error(`生命周期模块 ${module.name} 已有 owner`);
    // Ownership starts before start(): a rejection may still leave acquired resources.
    this.ownedModules.push(module);
    const startedAt = this.clock.monotonicNowMs();
    const details = await this.callbacks.run(() => module.start(context));
    const record: LifecycleStartupRecord = {
      phase, moduleName: module.name,
      startupTimeMs: Math.max(0, this.clock.monotonicNowMs() - startedAt),
      ...(details && Object.keys(details).length > 0 ? { details } : {}),
    };
    this.startedModules.push(module);
    this.startupRecords.push(record);
    await this.callbacks.run(() => this.observer.moduleStarted?.(record, context));
  }

  public stopStarted(context: TraceContext, deadline?: Deadline): Promise<void> {
    try { this.assertExternalCall(); } catch (error) { return Promise.reject(error); }
    this.closing = true;
    if (this.stopWait) return this.stopWait;
    if (!this.stopping || this.stopping.consumed) {
      const run: StopRun = { outcome: undefined!, settled: false, consumed: false };
      this.stopping = run;
      // Publish the operation owner before invoking any module or observer.
      run.outcome = Promise.resolve().then(() => this.drainAndStop(context)).then(
        () => { run.settled = true; return { ok: true }; },
        error => { run.settled = true; return { ok: false, error }; },
      );
    }
    const run = this.stopping;
    const waiting = this.waitForStop(run, deadline);
    this.stopWait = waiting;
    void waiting.then(() => { if (this.stopWait === waiting) this.stopWait = undefined; },
      () => { if (this.stopWait === waiting) this.stopWait = undefined; });
    return waiting;
  }

  private async waitForStop(run: StopRun, deadline?: Deadline): Promise<void> {
    let outcome: StopOutcome;
    if (deadline) {
      const result = await deadline.waitFor(run.outcome);
      if (result.status === 'expired') throw new Error('生命周期停止等待预算已到期；实际排空与结果仍由原 owner 持有');
      outcome = result.value;
    } else outcome = await run.outcome;
    run.consumed = true;
    if (!outcome.ok) throw outcome.error;
  }

  private async drainAndStop(context: TraceContext): Promise<void> {
    // No new starts can enter; settle accepted callbacks before releasing their resources.
    await Promise.allSettled([...this.pendingStarts]);
    const failures: unknown[] = [];
    for (const module of [...this.ownedModules].reverse()) {
      try { await this.callbacks.run(() => module.stop(context)); }
      catch (error) { failures.push(error); continue; }
      this.ownedModules.splice(this.ownedModules.indexOf(module), 1);
      const startedIndex = this.startedModules.indexOf(module);
      if (startedIndex >= 0) {
        this.startedModules.splice(startedIndex, 1);
        this.startupRecords.splice(startedIndex, 1);
      }
      // A failed observer cannot resurrect a released owner or skip other stops.
      try { await this.callbacks.run(() => this.observer.moduleStopped?.(module, context)); }
      catch (error) { failures.push(error); }
    }
    throwFailures(failures, '生命周期资源释放存在错误');
  }
}

function throwFailures(failures: readonly unknown[], message: string): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}
