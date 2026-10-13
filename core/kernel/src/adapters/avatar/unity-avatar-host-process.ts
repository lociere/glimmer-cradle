import fs from 'fs-extra';
import path from 'node:path';
import * as readline from 'node:readline';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AvatarConfig } from '../config/documents/AvatarConfig';
import { getLogger } from '../observability/logger';
import {
  resolveConfiguredProjectPath,
  resolveLogDir,
  resolveRepoRoot,
  resolveStatePath,
  resolveManagedProcessBridge,
} from '../filesystem/path-utils';
import { ManagedProcessSupervisor } from '@glimmer-cradle/platform';

type UnityAvatarHostConfig = AvatarConfig['host'];
type UnityAvatarHostProcessState = 'manual' | 'disabled' | 'starting' | 'running' | 'exited' | 'failed' | 'stopped';

const logger = getLogger('avatar-process');
const processSupervisor = new ManagedProcessSupervisor(logger);
const PROCESS_LOG_FILE = 'avatar-host.console.log';
const GRACEFUL_STOP_TIMEOUT_MS = 3000;

let avatarHostProcessLogDir = path.join(resolveLogDir(), 'application');

export function setUnityAvatarHostProcessLogRoot(logDir: string): void {
  avatarHostProcessLogDir = path.join(logDir, 'application');
}

function appendUnityAvatarHostProcessLog(record: Record<string, unknown>): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    source: 'avatar-process',
    ...record,
  });
  fs.ensureDir(avatarHostProcessLogDir)
    .then(() => fs.appendFile(path.join(avatarHostProcessLogDir, PROCESS_LOG_FILE), `${line}\n`, 'utf8'))
    .catch((error: any) => {
      // 不能再走 logger，避免日志 sink 失败时递归写日志。
      console.error('写入 Avatar 子进程日志失败', error);
    });
}

export interface UnityAvatarHostProcessSnapshot {
  readonly launch_mode: UnityAvatarHostConfig['launch_mode'];
  readonly state: UnityAvatarHostProcessState;
  readonly command?: string;
  readonly cwd?: string;
  readonly pid?: number;
  readonly started_at_ms?: number;
  readonly last_exit_code?: number | null;
  readonly last_exit_signal?: NodeJS.Signals | null;
  readonly last_error?: string;
}

type UnityAvatarHostProcessListener = (snapshot: UnityAvatarHostProcessSnapshot) => void;

export class UnityAvatarHostProcess {
  private static _instance: UnityAvatarHostProcess | null = null;
  private _process: ChildProcess | null = null;
  private _config: UnityAvatarHostConfig | null = null;
  private _state: UnityAvatarHostProcessState = 'disabled';
  private _lastExitCode: number | null | undefined;
  private _lastExitSignal: NodeJS.Signals | null | undefined;
  private _lastError: string | undefined;
  private _startedAtMs: number | undefined;
  private _stopRequested = false;
  private _stopOperation: Promise<void> | undefined;
  private _restartTimer: ReturnType<typeof setTimeout> | null = null;
  private _resolvedCommand: string | undefined;
  private _resolvedCwd: string | undefined;
  private _kernelEndpoint = '';
  private _kernelAuthToken = '';
  private readonly _listeners = new Set<UnityAvatarHostProcessListener>();

  public static get instance(): UnityAvatarHostProcess {
    if (!UnityAvatarHostProcess._instance) {
      UnityAvatarHostProcess._instance = new UnityAvatarHostProcess();
    }
    return UnityAvatarHostProcess._instance;
  }

  private constructor() {}

  public configure(config: UnityAvatarHostConfig, kernelEndpoint: string, authToken: string): void {
    this._config = config;
    this._kernelEndpoint = kernelEndpoint;
    this._kernelAuthToken = authToken;
    if (config.launch_mode !== 'managed') {
      this._state = config.launch_mode === 'manual' ? 'manual' : 'disabled';
      this._emitSnapshot();
      void this.stop().catch((error) => logger.error("Avatar 停机失败", { error: String(error) }));
      return;
    }

    if (!(process.env.GLIMMER_CRADLE_AVATAR_HOST_COMMAND?.trim() || config.command.trim())) {
      this._state = 'failed';
      this._lastError = 'Unity Avatar Host launch_mode=managed 但未配置 command';
      logger.warn('Avatar 受管启动未配置命令');
      this._emitSnapshot();
      return;
    }

    this.start();
  }

  public start(): void {
    const config = this._config;
    if (!config || config.launch_mode !== 'managed') return;
    if (this._stopOperation) throw new Error("Avatar 正在关闭");
    if (this._process) {
      if (this._state === "running" && !this._stopRequested) return;
      throw new Error("Avatar 上代进程尚未释放");
    }

    this._stopRequested = false;
    this._lastError = undefined;
    this._lastExitCode = undefined;
    this._lastExitSignal = undefined;
    this._startedAtMs = Date.now();
    this._state = 'starting';
    this._emitSnapshot();

    const repoRoot = resolveRepoRoot();
    const configuredCommand = process.env.GLIMMER_CRADLE_AVATAR_HOST_COMMAND?.trim()
      || config.command;
    const command = resolveExecutableCommand(configuredCommand, repoRoot);
    const cwd = process.env.GLIMMER_CRADLE_AVATAR_HOST_COMMAND?.trim()
      ? path.dirname(command)
      : resolveWorkingDirectory(config.cwd, repoRoot);
    this._resolvedCommand = command;
    this._resolvedCwd = cwd;

    if (isPathLikeCommand(configuredCommand) && !fs.existsSync(command)) {
      this._state = 'failed';
      this._lastError = `Avatar 构建产物不存在: ${command}。请运行 pnpm avatar:build。`;
      logger.warn('Avatar 构建产物不存在', {
        command,
        hint: 'pnpm avatar:build',
      });
      this._emitSnapshot();
      return;
    }

    // 安装树中的原生 launcher 与 Unity Player 分属不同组件目录。
    const packagedPlayer = process.env.GLIMMER_CRADLE_AVATAR_PLAYER_EXECUTABLE?.trim();
    const args = packagedPlayer ? [packagedPlayer, ...config.args.slice(1)] : config.args;
    const child = processSupervisor.spawnManagedProcess(command, args, {
      cwd,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        GLIMMER_CRADLE_AVATAR_PLACEMENT_PATH: resolveStatePath('desktop/avatar-placement.json'),
        GLIMMER_CRADLE_AVATAR_ACTION_STATE_PATH: resolveStatePath('avatar/action-state.json'),
        GLIMMER_CRADLE_AVATAR_GRPC_URL: this._kernelEndpoint,
        GLIMMER_CRADLE_AVATAR_AUTH_TOKEN: this._kernelAuthToken,
        GLIMMER_CRADLE_SUPERVISOR_PID: String(process.pid),
        ...config.env,
      },
      // 平台 launcher 负责在 Unity HWND 创建时完成 worker 隔离；这里不能直接
      // 隐藏 Unity Player，否则它可能停在场景初始化前。
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    }, resolveManagedProcessBridge(), spawn);
    this._process = child;
    processSupervisor.observeManagedProcess(child, process.platform !== 'win32');
    this._state = 'starting';
    this._emitSnapshot();

    const stdout = readline.createInterface({ input: child.stdout! });
    stdout.on('line', (line: any) => this.handleProcessLine('stdout', line));

    const stderr = readline.createInterface({ input: child.stderr! });
    stderr.on('line', (line: any) => this.handleProcessLine('stderr', line));

    child.on('error', (error: any) => {
      if (this._process !== child) return;
      this._state = 'failed';
      this._lastError = error.message;
      appendUnityAvatarHostProcessLog({ level: 'error', stream: 'process', message: error.message });
      logger.error('Avatar 受管进程启动失败', { error: error.message });
      this._emitSnapshot();
    });

    processSupervisor.onManagedProcessExit(child, (code, signal) => {
      if (this._process !== child) return;
      const released = processSupervisor.isProcessReleased(child);
      if (released) this._process = null;
      this._lastExitCode = code;
      this._lastExitSignal = signal;
      this._state = released ? (this._stopRequested ? 'stopped' : 'exited') : 'failed';
      if (!released) this._lastError = 'Avatar 子树回收未确认';
      logger.warn('Avatar 受管进程已退出', { code, signal });
      appendUnityAvatarHostProcessLog({
        level: this._stopRequested ? 'info' : 'warn',
        stream: 'process',
        message: `Avatar exited: code=${code}, signal=${signal}`,
      });
      this._emitSnapshot();

      if (released && !this._stopRequested && config.restart_on_exit) {
        this._restartTimer = setTimeout(() => this.start(), 2000);
      }
    });

    processSupervisor.onManagedProcessRootExit(child, (code, signal) => {
      if (this._process !== child || processSupervisor.isProcessReleased(child)) return;
      this._lastExitCode = code;
      this._lastExitSignal = signal;
      this._state = 'failed';
      this._lastError = 'Avatar 根已退出，受管子树仍在等待释放';
      this._emitSnapshot();
    });
    void processSupervisor.waitForManagedProcessReady(child, GRACEFUL_STOP_TIMEOUT_MS).then(() => {
      if (this._process === child && !this._stopRequested && this._lastExitCode === undefined) {
        this._state = 'running';
        this._emitSnapshot();
      }
    }).catch((error) => {
      if (this._process !== child) return;
      this._state = 'failed';
      this._lastError = String(error);
      this._emitSnapshot();
      void this.stop().catch((stopError) => logger.error('Avatar 启动失败后回收未确认', { error: String(stopError) }));
    });

    logger.info('Avatar 受管进程已启动', {
      command,
      cwd,
      pid: child.pid,
    });
  }

  public stop(): Promise<void> {
    if (this._stopOperation) return this._stopOperation;
    let resolveStop!: () => void;
    let rejectStop!: (error: unknown) => void;
    const operation = new Promise<void>((resolve, reject) => { resolveStop = resolve; rejectStop = reject; });
    this._stopOperation = operation;
    void this.stopChild().then(resolveStop, rejectStop);
    void operation.then(() => { this._stopOperation = undefined; }, () => { this._stopOperation = undefined; });
    return operation;
  }

  private async stopChild(): Promise<void> {
    this._stopRequested = true;
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }

    const child = this._process;
    if (!child) {
      if (this._state !== 'manual' && this._state !== 'disabled') {
        this._state = 'stopped';
      }
      this._emitSnapshot();
      return;
    }

    try {
      if (!await processSupervisor.waitForManagedProcessExit(child, GRACEFUL_STOP_TIMEOUT_MS) || !processSupervisor.isProcessReleased(child)) {
        await processSupervisor.forceTerminateManagedProcessTree(child, 'Avatar', 1500, process.platform !== 'win32');
      }
    } catch (error) {
      if (processSupervisor.isProcessReleased(child) && this._process === child) this._process = null;
      this._state = 'failed';
      this._lastError = error instanceof Error ? error.message : String(error);
      this._emitSnapshot();
      throw error;
    }
    if (this._process === child) this._process = null;

    if (this._state !== 'manual' && this._state !== 'disabled') {
      this._state = 'stopped';
    }
  }

  public getSnapshot(): UnityAvatarHostProcessSnapshot {
    return {
      launch_mode: this._config?.launch_mode ?? 'manual',
      state: this._state,
      command: this._resolvedCommand,
      cwd: this._resolvedCwd,
      pid: this._process ? processSupervisor.managedProcessPid(this._process) : undefined,
      started_at_ms: this._startedAtMs,
      last_exit_code: this._lastExitCode,
      last_exit_signal: this._lastExitSignal,
      last_error: this._lastError,
    };
  }

  public subscribe(listener: UnityAvatarHostProcessListener): () => void {
    this._listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this._listeners.delete(listener);
    };
  }

  private handleProcessLine(stream: 'stdout' | 'stderr', line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    appendUnityAvatarHostProcessLog({
      level: classifyUnityAvatarHostProcessLine(trimmed),
      stream,
      message: trimmed,
    });
  }

  private _emitSnapshot(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this._listeners) {
      listener(snapshot);
    }
  }
}


function resolveExecutableCommand(command: string, repoRoot: string): string {
  if (path.isAbsolute(command)) return command;
  if (isPathLikeCommand(command)) {
    return resolveConfiguredProjectPath(command, { repoRoot });
  }
  return command;
}

function isPathLikeCommand(command: string): boolean {
  return command.includes('/') || command.includes('\\') || /\.(exe|cmd|bat|ps1|sh)$/i.test(command);
}

function resolveWorkingDirectory(cwd: string, repoRoot: string): string {
  if (!cwd.trim()) return repoRoot;
  return path.isAbsolute(cwd) ? cwd : resolveConfiguredProjectPath(cwd, { repoRoot });
}

function classifyUnityAvatarHostProcessLine(line: string): 'debug' | 'info' | 'warn' | 'error' {
  if (/exception|fatal|critical|error/i.test(line)) return 'error';
  if (/warning|warn/i.test(line)) return 'warn';
  if (/debug|trace|verbose/i.test(line)) return 'debug';
  return 'info';
}
