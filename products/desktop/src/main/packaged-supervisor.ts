import { spawn, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
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

interface ProcessTreeAuthority { start(request: { program: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; session: string }): Promise<SupervisorChild>; stop(): Promise<{ terminated: boolean; active_process_count: number; session?: string }>; }

class NativeProcessTreeAuthority implements ProcessTreeAuthority {
  private helper: ReturnType<typeof spawn> | null = null;
  private buffer = '';
  private pending = new Map<string, (value: Record<string, unknown>) => void>();
  private sequence = 0;
  private session = '';
  public constructor(private readonly helperPath: string) {}
  public async start(request: { program: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; session: string }): Promise<SupervisorChild> {
    this.session = request.session;
    await this.ensureHelper(request.cwd, request.env);
    const response = await this.request({ op: 'start', session: request.session, command_line: [request.program, ...request.args].map((value) => `\"${value.replaceAll('\\', '\\\\').replaceAll('\"', '\\\"')}\"`).join(' ') });
    if (response.status !== 'started' || typeof response.root_pid !== 'number') throw new Error('desktop_process_tree_start_failed');
    return new BridgeChild(response.root_pid, this);
  }
  public async stop(): Promise<{ terminated: boolean; active_process_count: number }> {
    if (!this.helper) return { terminated: true, active_process_count: 0 };
    const result = await this.request({ op: 'stop', session: this.session });
    this.helper.stdin?.end(); this.helper = null;
    return { terminated: result.status === 'terminated', active_process_count: Number(result.active_process_count ?? -1) };
  }
  private async ensureHelper(cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
    if (this.helper) return;
    const helper = spawn(this.helperPath, [], { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    this.helper = helper;
    helper.stdout?.on('data', (chunk) => { this.buffer += chunk.toString(); let index = this.buffer.indexOf('\n'); while (index >= 0) { const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1); index = this.buffer.indexOf('\n'); try { const message = JSON.parse(line) as Record<string, unknown>; const resolve = this.pending.get(String(message.request_id ?? '')); if (resolve) { this.pending.delete(String(message.request_id)); resolve(message); } } catch { /* protocol timeout fails closed */ } } });
  }
  private request(payload: Record<string, unknown>): Promise<Record<string, unknown>> { if (!this.helper) return Promise.reject(new Error('desktop_process_tree_helper_unavailable')); const requestId = `req-${++this.sequence}`; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('desktop_process_tree_protocol_timeout')); }, 10_000); this.pending.set(requestId, (value) => { clearTimeout(timer); resolve(value); }); this.helper!.stdin!.write(`${JSON.stringify({ ...payload, request_id: requestId })}\n`); }); }
}
class BridgeChild extends EventEmitter implements SupervisorChild { public exitCode: number | null = null; public signalCode: NodeJS.Signals | null = null; public constructor(public readonly pid: number, private readonly authority: ProcessTreeAuthority) { super(); } public kill(signal: NodeJS.Signals = 'SIGTERM'): boolean { void this.authority.stop().then(() => { this.signalCode = signal; this.emit('exit', null, signal); }); return true; } }

export class PackagedSupervisor {
  private child: SupervisorChild | null = null;
  private snapshot: PackagedSupervisorSnapshot = {
    state: 'stopped',
    message: 'Desktop packaged supervisor 尚未启动',
  };
  private stopRequested = false;
  private launchSession: string | null = null;
  private processTree: ProcessTreeAuthority | null = null;

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
      readonly processTree?: ProcessTreeAuthority;
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
    const launchOptions: SpawnOptions = {
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
      };
    let child: SupervisorChild;
    if (this.options.spawnChild) {
      child = this.options.spawnChild(this.paths.nodeExecutable, [this.paths.kernelEntry], launchOptions);
    } else {
      this.processTree = this.options.processTree || new NativeProcessTreeAuthority(this.paths.processTreeHelper);
      child = await this.processTree.start({
        program: this.paths.nodeExecutable,
        args: [this.paths.kernelEntry],
        cwd: this.paths.appRoot,
        env: launchOptions.env || process.env,
        session: this.launchSession,
      });
    }
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
      if (this.processTree) {
        const result = await this.processTree.stop();
        if (!result.terminated || result.active_process_count !== 0) return false;
      } else {
        await (this.options.terminateTree || terminateTree)(child);
      }
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
  const observed = runtimes.filter((runtime): runtime is { blocking: boolean; state: string } => (
    Boolean(runtime)
    && typeof runtime === 'object'
    && typeof (runtime as { blocking?: unknown }).blocking === 'boolean'
    && typeof (runtime as { state?: unknown }).state === 'string'
  ));
  const blocking = runtimes.filter((runtime): runtime is { blocking: boolean; state: string } => (
    Boolean(runtime)
    && typeof runtime === 'object'
    && (runtime as { blocking?: unknown }).blocking === true
    && typeof (runtime as { state?: unknown }).state === 'string'
  ));
  if (blocking.length === 0) return 'waiting';
  if (blocking.some((runtime) => runtime.state === 'failed' || runtime.state === 'stopped')) return 'failed';
  if (!blocking.every((runtime) => runtime.state === 'ready' || runtime.state === 'degraded')) return 'waiting';
  return observed.some((runtime) => runtime.state === 'failed' || runtime.state === 'degraded')
    ? 'degraded'
    : 'ready';
}

async function terminateTree(child: SupervisorChild): Promise<void> {
  if (process.platform === 'win32' && child.pid) {
    const terminated = await new Promise<boolean>((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('error', () => resolve(false));
      killer.once('exit', (code) => resolve(code === 0));
    });
    if (!terminated) throw new Error('desktop_packaged_supervisor_taskkill_failed');
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
