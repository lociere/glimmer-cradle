import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import fs from 'fs-extra';
import type { AvatarConfig } from '@glimmer-cradle/protocol';
import { getLogger } from '../../../foundation/logger/logger';
import {
  resolveConfiguredProjectPath,
  resolveLogDir,
  resolveRepoRoot,
  resolveStatePath,
} from '../../../foundation/utils/path-utils';
import {
  forceTerminateManagedProcessTree,
  waitForManagedProcessExit,
} from '../../../foundation/process/process-supervisor';

type UnityAvatarHostConfig = AvatarConfig['host'];
type UnityAvatarHostProcessState = 'manual' | 'disabled' | 'starting' | 'running' | 'exited' | 'failed' | 'stopped';

const logger = getLogger('avatar-process');
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
    .catch((error) => {
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
  private _restartTimer: ReturnType<typeof setTimeout> | null = null;
  private _resolvedCommand: string | undefined;
  private _resolvedCwd: string | undefined;
  private _kernelEndpoint = '';
  private readonly _listeners = new Set<UnityAvatarHostProcessListener>();

  public static get instance(): UnityAvatarHostProcess {
    if (!UnityAvatarHostProcess._instance) {
      UnityAvatarHostProcess._instance = new UnityAvatarHostProcess();
    }
    return UnityAvatarHostProcess._instance;
  }

  private constructor() {}

  public configure(config: UnityAvatarHostConfig, kernelEndpoint: string): void {
    this._config = config;
    this._kernelEndpoint = kernelEndpoint;
    if (config.launch_mode !== 'managed') {
      this._state = config.launch_mode === 'manual' ? 'manual' : 'disabled';
      this._emitSnapshot();
      void this.stop();
      return;
    }

    if (!config.command.trim()) {
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
    if (this._process && !this._process.killed) return;

    this._stopRequested = false;
    this._lastError = undefined;
    this._lastExitCode = undefined;
    this._lastExitSignal = undefined;
    this._startedAtMs = Date.now();
    this._state = 'starting';
    this._emitSnapshot();

    const repoRoot = resolveRepoRoot();
    const command = resolveExecutableCommand(config.command, repoRoot);
    const cwd = resolveWorkingDirectory(config.cwd, repoRoot);
    this._resolvedCommand = command;
    this._resolvedCwd = cwd;

    if (isPathLikeCommand(config.command) && !fs.existsSync(command)) {
      this._state = 'failed';
      this._lastError = `Avatar 构建产物不存在: ${command}。请运行 pnpm avatar:build。`;
      logger.warn('Avatar 构建产物不存在', {
        command,
        hint: 'pnpm avatar:build',
      });
      this._emitSnapshot();
      return;
    }

    const child = spawn(command, config.args, {
      cwd,
      env: {
        ...process.env,
        GLIMMER_CRADLE_AVATAR_PLACEMENT_PATH: resolveStatePath('desktop/avatar-placement.json'),
        GLIMMER_CRADLE_AVATAR_ACTION_STATE_PATH: resolveStatePath('avatar/action-state.json'),
        GLIMMER_CRADLE_AVATAR_WS_URL: this._kernelEndpoint,
        GLIMMER_CRADLE_SUPERVISOR_PID: String(process.pid),
        ...config.env,
      },
      // 平台 launcher 负责在 Unity HWND 创建时完成 worker 隔离；这里不能直接
      // 隐藏 Unity Player，否则它可能停在场景初始化前。
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this._process = child;
    this._state = 'running';
    this._emitSnapshot();

    const stdout = readline.createInterface({ input: child.stdout });
    stdout.on('line', (line) => this.handleProcessLine('stdout', line));

    const stderr = readline.createInterface({ input: child.stderr });
    stderr.on('line', (line) => this.handleProcessLine('stderr', line));

    child.on('error', (error) => {
      this._state = 'failed';
      this._lastError = error.message;
      appendUnityAvatarHostProcessLog({ level: 'error', stream: 'process', message: error.message });
      logger.error('Avatar 受管进程启动失败', { error: error.message });
      this._emitSnapshot();
    });

    child.on('exit', (code, signal) => {
      this._process = null;
      this._lastExitCode = code;
      this._lastExitSignal = signal;
      this._state = this._stopRequested ? 'stopped' : 'exited';
      logger.warn('Avatar 受管进程已退出', { code, signal });
      appendUnityAvatarHostProcessLog({
        level: this._stopRequested ? 'info' : 'warn',
        stream: 'process',
        message: `Avatar exited: code=${code}, signal=${signal}`,
      });
      this._emitSnapshot();

      if (!this._stopRequested && config.restart_on_exit) {
        this._restartTimer = setTimeout(() => this.start(), 2000);
      }
    });

    logger.info('Avatar 受管进程已启动', {
      command,
      cwd,
      pid: child.pid,
    });
  }

  public async stop(): Promise<void> {
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

    if (await waitForManagedProcessExit(child, GRACEFUL_STOP_TIMEOUT_MS)) {
      return;
    }

    await forceTerminateManagedProcessTree(child, 'Avatar');

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
      pid: this._process?.pid,
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
