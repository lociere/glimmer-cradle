import { spawn, fork, type ChildProcess, type SpawnOptions, type ForkOptions } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { Duplex } from 'node:stream';
import type { Logger } from '../../observability/index.js';
import type { Clock, ScheduledTask } from '../../time/clock.js';
import { SystemClock } from '../../time/system-clock.js';

export interface ManagedProcessStopOptions {
  readonly label: string;
  readonly gracefulTimeoutMs?: number;
  readonly forceTimeoutMs?: number;
  readonly ownsProcessGroup?: boolean;
}

/** Private Node adapter seams; the App supplies its logger and owns the child handle. */
export interface ManagedProcessEnvironment {
  readonly platform: NodeJS.Platform;
  signalProcessGroup(pid: number, signal: NodeJS.Signals): void;
  isProcessGroupAlive?(pid: number): boolean;
}

export class ManagedProcessTerminationError extends Error {}

interface WindowsManagedProcess {
  readonly control: Duplex;
  readonly changed: Set<() => void>;
  readonly rootObservers: Set<(code: number, signal: null) => void>;
  readonly exitObservers: Set<(code: number | null, signal: NodeJS.Signals | null) => void>;
  readonly observerErrors: unknown[];
  readonly failures: Error[];
  buffer: Buffer;
  pid?: number;
  ready: boolean;
  rootCode?: number;
  released: boolean;
  launchFailed: boolean;
  notCreated: boolean;
  closed: boolean;
  controlDrained: boolean;
}

const nodeEnvironment: ManagedProcessEnvironment = {
  platform: process.platform,
  signalProcessGroup(pid, signal) { process.kill(-pid, signal); },
  isProcessGroupAlive(pid) {
    try { process.kill(-pid, 0); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
  },
};

/** Native process mechanism only: protocol shutdown, launch policy and readiness stay with the App. */
export class ManagedProcessSupervisor {
  private readonly unconfirmedTrees = new Set<ChildProcess>();
  private readonly ownedGroups = new Map<ChildProcess, number>();
  private readonly windowsJobs = new WeakMap<ChildProcess, WindowsManagedProcess>();
  private readonly observedProcesses = new WeakSet<ChildProcess>();
  private readonly failedSpawns = new WeakSet<ChildProcess>();
  private readonly exitObserverErrors = new WeakMap<ChildProcess, unknown[]>();
  public constructor(
    private readonly logger: Pick<Logger, 'warn' | 'info' | 'error'>,
    private readonly clock: Pick<Clock, 'monotonicNowMs' | 'schedule'> = new SystemClock(),
    private readonly environment: ManagedProcessEnvironment = nodeEnvironment,
  ) {}

  public spawnManagedProcess(
    command: string, args: readonly string[], options: SpawnOptions, windowsBridge: string | undefined,
    spawnPort: typeof spawn = spawn,
  ): ChildProcess {
    if (this.environment.platform !== 'win32') {
      const child = spawnPort(command, args, options);
      this.observeManagedProcess(child, options.detached === true);
      return child;
    }
    this.validateWindowsLaunch(windowsBridge, options);
    const child = spawnPort(windowsBridge!, ['--managed-launch', command, ...args], {
      ...options, shell: false, stdio: this.managedStdio(options.stdio),
    });
    this.observeWindowsJob(child);
    return child;
  }

  public forkManagedProcess(
    entry: string, args: readonly string[], options: ForkOptions, windowsBridge: string | undefined,
    forkPort: typeof fork = fork,
  ): ChildProcess {
    if (this.environment.platform !== 'win32') {
      const child = forkPort(entry, args, options);
      this.observeManagedProcess(child, options.detached === true);
      return child;
    }
    this.validateWindowsLaunch(windowsBridge, {});
    const child = forkPort(entry, args, {
      ...options, execPath: windowsBridge,
      execArgv: ['--managed-launch', options.execPath ?? process.execPath, ...(options.execArgv ?? process.execArgv)],
      stdio: this.managedStdio(options.stdio ?? ['pipe', 'pipe', 'pipe', 'ipc']),
    });
    this.observeWindowsJob(child);
    return child;
  }

  /** OS admission only; protocol registration and business readiness remain App-owned. */
  public async waitForManagedProcessReady(child: ChildProcess, timeoutMs: number): Promise<number> {
    validateTimeout(timeoutMs, false);
    const job = this.windowsJobs.get(child);
    if (!job) {
      if (child.pid) return child.pid;
      return new Promise<number>((resolve, reject) => {
        let timer: ScheduledTask | undefined;
        let done = false;
        const finish = (error?: unknown): void => {
          if (done) return;
          done = true;
          child.off('spawn', onSpawn); child.off('error', onError);
          try { timer?.cancel(); } catch (cancelError) { reject(cancelError); return; }
          if (error !== undefined) reject(error);
          else if (child.pid) resolve(child.pid);
          else reject(new ManagedProcessTerminationError('受管子进程未取得 PID'));
        };
        const onSpawn = (): void => finish();
        const onError = (error: Error): void => finish(error);
        child.once('spawn', onSpawn); child.once('error', onError);
        try {
          timer = this.clock.schedule(timeoutMs, () => finish(new ManagedProcessTerminationError('受管进程启动未在期限内确认')));
          if (done) timer.cancel();
          else if (this.failedSpawns.has(child)) finish(new ManagedProcessTerminationError('受管目标未创建'));
        } catch (error) { finish(error); }
      });
    }
    await this.waitForJob(child, job, timeoutMs, () => {
      if (!job.ready && job.rootCode !== undefined) throw new ManagedProcessTerminationError('受管根在接纳前已退出');
      return job.ready;
    }, 0);
    return job.pid!;
  }

  public managedProcessPid(child: ChildProcess): number | undefined {
    const job = this.windowsJobs.get(child);
    return job ? job.pid : child.pid;
  }

  public isManagedProcessRootRunning(child: ChildProcess): boolean {
    const job = this.windowsJobs.get(child);
    return child.pid !== undefined && !hasExited(child) && !this.failedSpawns.has(child) && (!job || job.rootCode === undefined && !job.launchFailed);
  }

  public onManagedProcessRootExit(child: ChildProcess, observer: (code: number | null, signal: NodeJS.Signals | null) => void): void {
    const job = this.windowsJobs.get(child);
    if (!job) { child.once('exit', this.guardExitObserver(child, observer)); return; }
    const guarded = (code: number): void => {
      try { observer(code, null); } catch (error) { job.observerErrors.push(error); }
    };
    if (job.rootCode !== undefined) guarded(job.rootCode);
    else job.rootObservers.add(guarded);
  }

  /** Native exit is delivered after FD4 drains; Node's aggregate IPC close is not release proof. */
  public onManagedProcessExit(child: ChildProcess, observer: (code: number | null, signal: NodeJS.Signals | null) => void): void {
    const job = this.windowsJobs.get(child);
    if (!job) { child.once('exit', this.guardExitObserver(child, observer)); return; }
    const guarded = (code: number | null, signal: NodeJS.Signals | null): void => {
      try { observer(code, signal); } catch (error) { job.observerErrors.push(error); }
    };
    if (job.closed) guarded(child.exitCode, child.signalCode);
    else job.exitObservers.add(guarded);
  }

  public observeManagedProcess(child: ChildProcess, ownsProcessGroup: boolean): void {
    if (!this.windowsJobs.has(child) && !this.observedProcesses.has(child)) {
      this.observedProcesses.add(child);
      child.once('error', () => { if (child.pid === undefined) this.failedSpawns.add(child); });
    }
    if (ownsProcessGroup && this.environment.platform !== 'win32' && child.pid) this.ownedGroups.set(child, child.pid);
  }

  public isProcessReleased(child: ChildProcess): boolean {
    if (this.failedSpawns.has(child)) return true;
    const job = this.windowsJobs.get(child);
    if (job) return job.launchFailed || (job.released || job.notCreated) && job.closed && hasExited(child);
    if (this.environment.platform === 'win32' && child.pid) return false;
    if (!hasExited(child)) return false;
    const group = this.ownedGroups.get(child);
    if (group !== undefined) {
      try {
        if (!this.environment.isProcessGroupAlive || this.environment.isProcessGroupAlive(group)) return false;
      } catch { return false; }
      this.ownedGroups.delete(child);
      this.unconfirmedTrees.delete(child);
    }
    return !this.unconfirmedTrees.has(child);
  }

  public waitForManagedProcessExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
    validateTimeout(timeoutMs, true);
    const job = this.windowsJobs.get(child);
    const event = job ? 'close' : 'exit';
    const exited = (): boolean => job ? job.closed : hasExited(child) || this.failedSpawns.has(child);
    if (exited()) return Promise.resolve(true);
    return new Promise<boolean>((resolve, reject) => {
      let finished = false;
      let timer: ScheduledTask | undefined;
      const finish = (exited: boolean): void => {
        if (finished) return;
        finished = true;
        child.off(event, onExit);
        child.off('error', onError);
        job?.changed.delete(onExit);
        try { timer?.cancel(); } catch (error) { reject(error); return; }
        resolve(exited);
      };
      const onExit = (): void => { if (!job || job.closed) finish(true); };
      const onError = (): void => { if (exited()) finish(true); };
      if (job) job.changed.add(onExit);
      else child.once(event, onExit);
      child.on('error', onError);
      try {
        timer = this.clock.schedule(timeoutMs, () => finish(false));
        if (finished) timer.cancel();
        else if (exited()) finish(true);
      } catch (error) { child.off(event, onExit); child.off('error', onError); job?.changed.delete(onExit); reject(error); }
    });
  }

  public async forceTerminateManagedProcessTree(
    child: ChildProcess, label: string, timeoutMs = 1500, ownsProcessGroup = false,
  ): Promise<void> {
    validateTimeout(timeoutMs, false);
    this.observeManagedProcess(child, ownsProcessGroup);
    if (this.isProcessReleased(child)) { this.reportExitObserverErrors(child); return; }
    const job = this.windowsJobs.get(child);
    if (job) {
      if (job.notCreated) {
        await this.waitForJob(child, job, timeoutMs, () => this.isProcessReleased(child), job.failures.length);
        return;
      }
      const observerErrors: unknown[] = [];
      try { this.logger.warn('受管进程树通过已持有的 Windows Job 回收', { label, pid: job.pid }); }
      catch (error) { observerErrors.push(error); }
      if (hasExited(child) && !job.closed) await this.waitForManagedProcessExit(child, timeoutMs);
      if (this.isProcessReleased(child)) {
        if (observerErrors.length || job.observerErrors.length) throw new AggregateError([...job.observerErrors, ...observerErrors], '受管进程已退出，但停止 observer 失败');
        return;
      }
      if (hasExited(child) || job.control.destroyed) throw new ManagedProcessTerminationError('Native 监督已退出但 Job 释放回执缺失，保留 owner；禁止复用 PID 回收');
      const errorsBeforeStop = job.failures.length;
      const frame = Buffer.alloc(8); frame.writeUInt32LE(2, 0); frame.writeUInt32LE(timeoutMs, 4);
      job.control.write(frame);
      await this.waitForJob(child, job, timeoutMs, () => this.isProcessReleased(child), errorsBeforeStop);
      if (observerErrors.length || job.observerErrors.length) throw new AggregateError([...job.observerErrors, ...observerErrors], '受管进程已退出，但停止 observer 失败');
      return;
    }
    if (hasExited(child)) {
      throw new ManagedProcessTerminationError('进程已退出但子树回收未确认，禁止复用其 PID 重试；须由 owner 对账');
    }
    if (this.environment.platform === 'win32') throw new ManagedProcessTerminationError('Windows 进程缺少所属 Native Job owner，禁止通过 PID 回收或推断子树已空');
    this.unconfirmedTrees.add(child);
    const deadline = this.clock.monotonicNowMs() + timeoutMs;
    const observerErrors: unknown[] = [];
    const observe = (operation: () => void): void => {
      try { operation(); } catch (error) { observerErrors.push(error); }
    };
    let commandError: unknown;
    try {
      if (ownsProcessGroup && child.pid) {
        observe(() => this.logger.warn('受管进程组未按时退出，发送 SIGKILL', { label, pid: child.pid }));
        this.environment.signalProcessGroup(child.pid, 'SIGKILL');
      } else {
        observe(() => this.logger.warn('受管进程未按时退出，发送 SIGKILL', { label, pid: child.pid }));
        child.kill('SIGKILL');
      }
    } catch (error) { commandError = error; }
    // Command acceptance and child.killed are not exit receipts. Keep failure recoverable by the owner.
    const rootExited = await this.waitForManagedProcessExit(child, this.remaining(deadline));
    const exited = rootExited && await this.waitForOwnedGroupExit(child, deadline);
    if (!exited) {
      observe(() => this.logger.error('受管进程回收后仍未确认退出', { label, pid: child.pid }));
      const failure = new ManagedProcessTerminationError(`受管进程 ${label} 未在回收期限内退出`);
      if (commandError !== undefined || observerErrors.length > 0) {
        throw new AggregateError([failure, ...(commandError === undefined ? [] : [commandError]), ...observerErrors], failure.message);
      }
      throw failure;
    }
    if (commandError !== undefined) {
      throw new AggregateError([commandError, ...observerErrors], '进程已退出但子树回收命令失败，保留未确认 owner');
    }
    this.unconfirmedTrees.delete(child);
    observerErrors.push(...(this.exitObserverErrors.get(child) ?? []));
    if (observerErrors.length > 0) throw new AggregateError(observerErrors, '受管进程已退出，但停止 observer 失败');
  }

  public async stopManagedProcess(child: ChildProcess | null | undefined, options: ManagedProcessStopOptions): Promise<void> {
    const gracefulTimeoutMs = options.gracefulTimeoutMs ?? 5000;
    const forceTimeoutMs = options.forceTimeoutMs ?? 1500;
    validateTimeout(gracefulTimeoutMs, true);
    validateTimeout(forceTimeoutMs, false);
    if (!child) return;
    this.observeManagedProcess(child, options.ownsProcessGroup ?? false);
    if (this.isProcessReleased(child)) { this.reportExitObserverErrors(child); return; }
    if (this.windowsJobs.has(child)) {
      await this.forceTerminateManagedProcessTree(child, options.label, forceTimeoutMs);
      return;
    }
    if (hasExited(child)) {
      if (await this.waitForOwnedGroupExit(child, this.clock.monotonicNowMs() + gracefulTimeoutMs) && this.isProcessReleased(child)) { this.reportExitObserverErrors(child); return; }
      throw new ManagedProcessTerminationError("根已退出但受管边界未释放，禁止重用死 PID 回收");
    }
    if (this.environment.platform === 'win32' && child.pid) {
      // Terminating a launcher alone may detach its descendants on Windows.
      await this.forceTerminateManagedProcessTree(child, options.label, forceTimeoutMs, false);
      return;
    }
    if (options.ownsProcessGroup && child.pid) this.environment.signalProcessGroup(child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
    const deadline = this.clock.monotonicNowMs() + gracefulTimeoutMs;
    if (await this.waitForManagedProcessExit(child, gracefulTimeoutMs) && await this.waitForOwnedGroupExit(child, deadline) && this.isProcessReleased(child)) { this.reportExitObserverErrors(child); return; }
    await this.forceTerminateManagedProcessTree(child, options.label, forceTimeoutMs, options.ownsProcessGroup);
  }

  private async waitForOwnedGroupExit(child: ChildProcess, deadline: number): Promise<boolean> {
    const group = this.ownedGroups.get(child);
    if (group === undefined) return true;
    for (;;) {
      if (!this.environment.isProcessGroupAlive) return false;
      if (!this.environment.isProcessGroupAlive(group)) return true;
      const remaining = this.remaining(deadline);
      if (remaining <= 0) return false;
      await new Promise<void>((resolve, reject) => {
        try { this.clock.schedule(Math.min(25, remaining), resolve); } catch (error) { reject(error); }
      });
    }
  }

  private validateWindowsLaunch(bridge: string | undefined, options: SpawnOptions): void {
    if (!bridge || !isAbsolute(bridge) || options.shell) throw new ManagedProcessTerminationError('Windows 受管启动须由 App 注入绝对 Native bridge 路径且不能经 shell');
  }

  private guardExitObserver(child: ChildProcess, observer: (code: number | null, signal: NodeJS.Signals | null) => void): (code: number | null, signal: NodeJS.Signals | null) => void {
    return (code, signal) => {
      try { observer(code, signal); }
      catch (error) {
        const errors = this.exitObserverErrors.get(child) ?? [];
        errors.push(error); this.exitObserverErrors.set(child, errors);
      }
    };
  }

  private reportExitObserverErrors(child: ChildProcess): void {
    const errors = this.windowsJobs.get(child)?.observerErrors ?? this.exitObserverErrors.get(child) ?? [];
    if (errors.length) throw new AggregateError([...errors], '受管进程已退出，但停止 observer 失败');
  }

  private managedStdio(stdio: SpawnOptions['stdio']): SpawnOptions['stdio'] {
    if (stdio !== undefined && !Array.isArray(stdio)) throw new ManagedProcessTerminationError('Windows 受管启动须显式指定 stdio 描述符');
    const descriptors = [...(stdio ?? ['pipe', 'pipe', 'pipe'])];
    if (descriptors.length > 4) throw new ManagedProcessTerminationError('FD4 由 Native 进程监督独占');
    while (descriptors.length < 4) descriptors.push('ignore');
    return [...descriptors, 'pipe'];
  }

  private observeWindowsJob(child: ChildProcess): void {
    const control = child.stdio[4] as Duplex | null;
    if (!control) throw new ManagedProcessTerminationError('Native 进程监督缺少控制描述符');
    const job: WindowsManagedProcess = {
      control, changed: new Set(), rootObservers: new Set(), exitObservers: new Set(), observerErrors: [], failures: [], buffer: Buffer.alloc(0),
      ready: false, released: false, launchFailed: false, notCreated: false, closed: false, controlDrained: false,
    };
    this.windowsJobs.set(child, job);
    const notify = (): void => { for (const observer of [...job.changed]) observer(); };
    const fail = (error: Error): void => { job.failures.push(error); notify(); };
    const complete = (): void => {
      if (!job.closed && job.controlDrained && (hasExited(child) || job.launchFailed)) {
        job.closed = true;
        for (const observer of job.exitObservers) observer(child.exitCode, child.signalCode);
        job.exitObservers.clear();
        if (!job.released && !job.notCreated && !job.launchFailed) fail(new ManagedProcessTerminationError('Native 监督退出但 Job 释放回执缺失'));
      }
      notify();
    };
    control.on('data', (bytes: Buffer) => {
      try {
        job.buffer = Buffer.concat([job.buffer, bytes]);
        while (job.buffer.length >= 4) {
          const size = job.buffer.readUInt32LE(0);
          if (size < 16 || size > 1024) throw new ManagedProcessTerminationError('Native 进程监督回执长度无效');
          if (job.buffer.length < 4 + size) break;
          const body = job.buffer.subarray(4, 4 + size);
          const length = body.readUInt32LE(4);
          if (length + 16 !== size) throw new ManagedProcessTerminationError('Native 进程监督回执字段无效');
          const code = body.readUInt32LE(0);
          const event = body.subarray(8, 8 + length).toString('utf8');
          const pid = body.readUInt32LE(8 + length);
          const active = body.readUInt32LE(12 + length);
          if (event === 'managed.not-created' && code !== 0 && pid === 0 && active === 0 && job.pid === undefined) {
            job.buffer = job.buffer.subarray(4 + size);
            job.notCreated = true;
            fail(new ManagedProcessTerminationError(`Native 目标未创建: ${code}`));
            continue;
          }
          if (!pid || job.pid !== undefined && job.pid !== pid) throw new ManagedProcessTerminationError('Native 进程监督根身份变化');
          job.pid = pid;
          job.buffer = job.buffer.subarray(4 + size);
          if (event === 'managed.error') fail(new ManagedProcessTerminationError(`Native 进程监督失败: ${code}`));
          else if (event === 'managed.ready' && code === 0 && job.rootCode === undefined) job.ready = true;
          else if (event === 'managed.root-exited' && job.rootCode === undefined) {
            job.rootCode = code;
            for (const observer of job.rootObservers) observer(code, null);
            job.rootObservers.clear();
          } else if (event === 'managed.released' && code === 0 && active === 0 && job.rootCode !== undefined) job.released = true;
          else throw new ManagedProcessTerminationError('Native 进程监督回执顺序或类型无效');
          notify();
        }
      } catch (error) {
        job.released = false;
        fail(error instanceof Error ? error : new Error(String(error)));
        control.destroy();
      }
    });
    control.once('error', fail);
    control.once('end', () => {
      job.controlDrained = true;
      if (!job.released && !job.notCreated) fail(new ManagedProcessTerminationError('Native 控制连接关闭但 Job 释放回执缺失'));
      complete();
    });
    control.once('close', () => { job.controlDrained = true; complete(); });
    child.once('error', (error) => { job.launchFailed = child.pid === undefined; fail(error); complete(); });
    // exit may precede the last FD4 frame. Parent-initiated advanced fork disconnect can
    // also omit Node's aggregate close, so wait for the actual helper exit and FD4 drain.
    child.once('exit', complete);
    child.once('close', complete);
  }

  private waitForJob(child: ChildProcess, job: WindowsManagedProcess, timeoutMs: number, satisfied: () => boolean, failureIndex: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let done = false;
      let timer: ScheduledTask | undefined;
      const finish = (error?: unknown): void => {
        if (done) return;
        done = true;
        job.changed.delete(check);
        try { timer?.cancel(); } catch (cancelError) { reject(error === undefined ? cancelError : new AggregateError([error, cancelError], 'Native 等待与 timer 释放失败')); return; }
        if (error !== undefined) reject(error); else resolve();
      };
      const check = (): void => {
        try {
          if (satisfied()) finish();
          else if (job.failures.length > failureIndex) finish(job.failures[failureIndex]);
        } catch (error) { finish(error); }
      };
      job.changed.add(check);
      try {
        timer = this.clock.schedule(timeoutMs, () => finish(new ManagedProcessTerminationError('Native 进程树未在期限内确认释放或接纳')));
        if (done) timer.cancel();
        check();
      } catch (error) { finish(error); }
    });
  }

  private remaining(deadline: number): number {
    return Math.max(0, Math.min(2_147_483_647, Math.ceil(deadline - this.clock.monotonicNowMs())));
  }
}

function hasExited(child: ChildProcess): boolean { return child.exitCode != null || child.signalCode != null; }
function validateTimeout(value: number, allowZero: boolean): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 2_147_483_647) {
    throw new ManagedProcessTerminationError('受管进程 timeout 无效');
  }
}
