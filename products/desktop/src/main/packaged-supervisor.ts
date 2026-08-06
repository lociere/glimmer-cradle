import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import WebSocket, { type RawData } from 'ws';
import type { PackagedDesktopPaths } from './packaged-paths';

export type PackagedSupervisorState =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'failed'
  | 'stopping';

export interface PackagedSupervisorSnapshot {
  readonly state: PackagedSupervisorState;
  readonly kernel_pid?: number;
  readonly launch_session?: string;
  readonly message: string;
}

type ProbeReadiness = 'waiting' | 'ready' | 'degraded' | 'failed';

interface SupervisorChild {
  readonly pid?: number;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export class PackagedSupervisor {
  private child: SupervisorChild | null = null;
  private snapshot: PackagedSupervisorSnapshot = {
    state: 'stopped',
    message: 'Desktop packaged supervisor 尚未启动',
  };
  private stopRequested = false;
  private launchSession: string | null = null;

  public constructor(
    private readonly paths: PackagedDesktopPaths,
    private readonly options: {
      readonly spawnChild?: (
        command: string,
        args: string[],
        options: SpawnOptions,
      ) => SupervisorChild;
      readonly probe?: (
        paths: PackagedDesktopPaths,
        child: SupervisorChild,
        launchSession: string,
      ) => Promise<ProbeReadiness>;
      readonly readyTimeoutMs?: number;
      readonly pollIntervalMs?: number;
      readonly stopTimeoutMs?: number;
      readonly terminateTree?: (child: SupervisorChild) => Promise<void>;
    } = {},
  ) {}

  public getSnapshot(): PackagedSupervisorSnapshot {
    return this.snapshot;
  }

  public async start(): Promise<PackagedSupervisorSnapshot> {
    if (this.snapshot.state !== 'stopped') return this.snapshot;
    this.stopRequested = false;
    this.launchSession = randomUUID();
    await this.project('starting', '正在启动安装态 Kernel supervisor');
    const spawnChild = this.options.spawnChild || ((command, args, options) => (
      spawn(command, args, options) as ChildProcess
    ));
    const child = spawnChild(
      this.paths.nodeExecutable,
      [this.paths.kernelEntry],
      {
        cwd: this.paths.appRoot,
        windowsHide: true,
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          GLIMMER_CRADLE_APP_ROOT: this.paths.appRoot,
          GLIMMER_CRADLE_DATA_ROOT: this.paths.dataRoot,
          GLIMMER_CRADLE_CONFIG_ROOT: this.paths.configRoot,
          GLIMMER_CRADLE_RUN_ROOT: this.paths.runRoot,
          GLIMMER_CRADLE_PRODUCT_MANIFEST: this.paths.productManifest,
          GLIMMER_CRADLE_EXTENSION_MODULE_ROOT: this.paths.extensionModuleRoot,
          GLIMMER_CRADLE_PYTHON_RUNTIME: this.paths.pythonExecutable,
          GLIMMER_CRADLE_AVATAR_HOST_COMMAND: this.paths.avatarHostExecutable,
          GLIMMER_CRADLE_NATIVE_LIB: this.paths.nativeLibrary,
          GLIMMER_CRADLE_SUPERVISOR_PID: String(process.pid),
          GLIMMER_CRADLE_LAUNCH_SESSION: this.launchSession,
        },
      },
    );
    this.child = child;
    child.once('error', (error) => {
      if (this.child !== child) return;
      void this.project('failed', `Kernel 启动失败: ${error.message}`);
    });
    child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.stopRequested) return;
      void this.project(
        'failed',
        `Kernel 意外退出: code=${code ?? 'null'}, signal=${signal ?? 'null'}`,
      );
    });

    const deadline = Date.now() + (this.options.readyTimeoutMs ?? 120_000);
    const probe = this.options.probe || probePackagedKernelReadiness;
    while (Date.now() < deadline && !this.stopRequested) {
      if (hasExited(child)) throw new Error(this.snapshot.message);
      const readiness = await probe(this.paths, child, this.launchSession);
      if (readiness === 'failed') {
        await this.failStartup('Kernel runtime readiness catalog 报告 blocking failure');
        throw new Error('desktop_packaged_supervisor_readiness_failed');
      }
      if (readiness === 'ready' || readiness === 'degraded') {
        await this.project(
          readiness,
          readiness === 'ready'
            ? 'Kernel runtime readiness catalog 已 ready'
            : 'Kernel 已启动，存在可观察的非阻塞降级能力',
        );
        return this.snapshot;
      }
      await delay(this.options.pollIntervalMs ?? 250);
    }
    if (!this.stopRequested) {
      await this.failStartup('Kernel readiness 超时');
      throw new Error('desktop_packaged_supervisor_ready_timeout');
    }
    return this.snapshot;
  }

  public async stop(): Promise<void> {
    if (this.snapshot.state === 'stopped') return;
    this.stopRequested = true;
    await this.project('stopping', '正在停止安装态进程树');
    if (!await this.terminateActiveTree()) {
      await this.project('failed', '安装态进程树退出未确认；保留 stopping/failed 投影供恢复处理');
      return;
    }
    this.launchSession = null;
    await rm(path.join(this.paths.runRoot, 'desktop-supervisor.json'), { force: true });
    this.snapshot = { state: 'stopped', message: 'Desktop packaged supervisor 已停止' };
  }

  private async project(state: PackagedSupervisorState, message: string): Promise<void> {
    this.snapshot = {
      state,
      kernel_pid: this.child?.pid,
      ...(this.launchSession ? { launch_session: this.launchSession } : {}),
      message,
    };
    await mkdir(this.paths.runRoot, { recursive: true });
    await writeFile(
      path.join(this.paths.runRoot, 'desktop-supervisor.json'),
      `${JSON.stringify({ ...this.snapshot, updated_at: new Date().toISOString() })}\n`,
    );
  }

  private async failStartup(message: string): Promise<void> {
    await this.project('failed', message);
    if (!await this.terminateActiveTree()) {
      await this.project('failed', `${message}；安装态进程树退出未确认`);
    }
  }

  private async terminateActiveTree(): Promise<boolean> {
    const child = this.child;
    if (!child || hasExited(child)) {
      if (this.child === child) this.child = null;
      return true;
    }
    try {
      await (this.options.terminateTree || terminateTree)(child);
    } catch (error) {
      await this.project('failed', `安装态进程树终止失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    const exited = await waitForExit(child, this.options.stopTimeoutMs ?? 5_000);
    if (exited && this.child === child) this.child = null;
    return exited;
  }
}

export async function probePackagedKernelReadiness(
  paths: PackagedDesktopPaths,
  child: SupervisorChild,
  launchSession: string,
): Promise<ProbeReadiness> {
  try {
    const catalog = JSON.parse(
      await readFile(path.join(paths.runRoot, 'host', 'endpoints.json'), 'utf8'),
    ) as {
      readonly generation?: string;
      readonly owner_pid?: number;
      readonly endpoints?: Array<{
        readonly owner?: string;
        readonly owner_pid?: number;
        readonly generation?: string;
        readonly purpose?: string;
        readonly endpoint?: string;
      }>;
    };
    const endpoint = Array.isArray(catalog.endpoints)
      ? catalog.endpoints.find((entry) => entry?.purpose === 'control-surface')
      : null;
    if (catalog.owner_pid !== child.pid
      || catalog.generation !== launchSession
      || endpoint?.owner !== 'kernel'
      || endpoint.owner_pid !== child.pid
      || endpoint.generation !== launchSession
      || typeof endpoint.endpoint !== 'string') return 'waiting';
    return probeRuntimeReadinessCatalog(endpoint.endpoint);
  } catch {
    return 'waiting';
  }
}

async function probeRuntimeReadinessCatalog(endpoint: string): Promise<ProbeReadiness> {
  return new Promise((resolve) => {
    const socket = new WebSocket(endpoint, { handshakeTimeout: 1_000, maxPayload: 2 * 1024 * 1024 });
    let settled = false;
    const finish = (result: ProbeReadiness): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeAllListeners();
      socket.terminate();
      resolve(result);
    };
    const timeout = setTimeout(() => finish('waiting'), 1_500);
    socket.on('message', (raw: RawData) => {
      try {
        const frame = JSON.parse(raw.toString()) as { kind?: unknown; runtime_readiness?: unknown };
        if (frame.kind === 'runtime_readiness') finish(classifyRuntimeReadiness(frame.runtime_readiness));
      } catch {
        finish('waiting');
      }
    });
    socket.once('error', () => finish('waiting'));
    socket.once('close', () => finish('waiting'));
  });
}

function classifyRuntimeReadiness(value: unknown): ProbeReadiness {
  const runtimes = (value as { runtimes?: unknown })?.runtimes;
  if (!Array.isArray(runtimes)) return 'waiting';
  const blocking = runtimes.filter((runtime): runtime is { blocking: boolean; state: string } => (
    Boolean(runtime)
    && typeof runtime === 'object'
    && (runtime as { blocking?: unknown }).blocking === true
    && typeof (runtime as { state?: unknown }).state === 'string'
  ));
  if (blocking.length === 0) return 'waiting';
  if (blocking.some((runtime) => runtime.state === 'failed' || runtime.state === 'stopped')) return 'failed';
  if (!blocking.every((runtime) => runtime.state === 'ready' || runtime.state === 'degraded')) return 'waiting';
  return blocking.some((runtime) => runtime.state === 'degraded') ? 'degraded' : 'ready';
}

async function terminateTree(child: SupervisorChild): Promise<void> {
  if (process.platform === 'win32' && child.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('error', () => resolve());
      killer.once('exit', () => resolve());
    });
    return;
  }
  child.kill('SIGTERM');
  await delay(2500);
  if (!hasExited(child)) child.kill('SIGKILL');
}

async function waitForExit(child: SupervisorChild, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!hasExited(child) && Date.now() < deadline) {
    await delay(Math.min(50, Math.max(1, deadline - Date.now())));
  }
  return hasExited(child);
}

function hasExited(child: SupervisorChild): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
