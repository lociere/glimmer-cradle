import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
  readonly message: string;
}

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
      ) => Promise<'waiting' | 'ready' | 'degraded'>;
      readonly readyTimeoutMs?: number;
      readonly pollIntervalMs?: number;
      readonly terminateTree?: (child: SupervisorChild) => Promise<void>;
    } = {},
  ) {}

  public getSnapshot(): PackagedSupervisorSnapshot {
    return this.snapshot;
  }

  public async start(): Promise<PackagedSupervisorSnapshot> {
    if (this.snapshot.state !== 'stopped') return this.snapshot;
    this.stopRequested = false;
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
        },
      },
    );
    this.child = child;
    child.once('error', (error) => {
      void this.project('failed', `Kernel 启动失败: ${error.message}`);
    });
    child.once('exit', (code, signal) => {
      this.child = null;
      if (this.stopRequested) {
        this.snapshot = {
          state: 'stopped',
          message: 'Desktop packaged supervisor 已停止',
        };
        return;
      }
      void this.project(
        'failed',
        `Kernel 意外退出: code=${code ?? 'null'}, signal=${signal ?? 'null'}`,
      );
    });

    const deadline = Date.now() + (this.options.readyTimeoutMs ?? 120_000);
    const probe = this.options.probe || defaultProbe;
    while (Date.now() < deadline && !this.stopRequested) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(this.snapshot.message);
      }
      const readiness = await probe(this.paths, child);
      if (readiness === 'ready' || readiness === 'degraded') {
        await this.project(
          readiness,
          readiness === 'ready'
            ? 'Kernel control surface 已 ready'
            : 'Kernel 已启动，存在可观察的非阻塞降级能力',
        );
        return this.snapshot;
      }
      await delay(this.options.pollIntervalMs ?? 250);
    }
    if (!this.stopRequested) {
      await this.project('failed', 'Kernel readiness 超时');
      await this.stop();
      throw new Error('desktop_packaged_supervisor_ready_timeout');
    }
    return this.snapshot;
  }

  public async stop(): Promise<void> {
    if (this.snapshot.state === 'stopped' || this.snapshot.state === 'stopping') return;
    this.stopRequested = true;
    await this.project('stopping', '正在停止安装态进程树');
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      await (this.options.terminateTree || terminateTree)(child);
    }
    this.child = null;
    await rm(path.join(this.paths.runRoot, 'desktop-supervisor.json'), { force: true });
    this.snapshot = { state: 'stopped', message: 'Desktop packaged supervisor 已停止' };
  }

  private async project(state: PackagedSupervisorState, message: string): Promise<void> {
    this.snapshot = {
      state,
      kernel_pid: this.child?.pid,
      message,
    };
    await mkdir(this.paths.runRoot, { recursive: true });
    await writeFile(
      path.join(this.paths.runRoot, 'desktop-supervisor.json'),
      `${JSON.stringify({ ...this.snapshot, updated_at: new Date().toISOString() })}\n`,
    );
  }
}

async function defaultProbe(
  paths: PackagedDesktopPaths,
  child: SupervisorChild,
): Promise<'waiting' | 'ready'> {
  try {
    const catalog = JSON.parse(
      await readFile(path.join(paths.runRoot, 'host', 'endpoints.json'), 'utf8'),
    ) as {
      readonly owner_pid?: number;
      readonly endpoints?: Array<{ readonly purpose?: string; readonly endpoint?: string }>;
    };
    const endpoint = Array.isArray(catalog.endpoints)
      ? catalog.endpoints.find((entry: { purpose?: string }) => entry?.purpose === 'control-surface')
      : null;
    return catalog.owner_pid === child.pid && typeof endpoint?.endpoint === 'string'
      ? 'ready'
      : 'waiting';
  } catch {
    return 'waiting';
  }
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
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
