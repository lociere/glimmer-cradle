import { spawn, type ChildProcess } from 'node:child_process';
import { getLogger } from '../logger/logger';

const logger = getLogger('process-supervisor');

export interface ManagedProcessStopOptions {
  readonly label: string;
  readonly gracefulTimeoutMs?: number;
  readonly forceTimeoutMs?: number;
  readonly ownsProcessGroup?: boolean;
}

/**
 * 等待已启动子进程退出。
 *
 * 子进程的 `killed` 只说明已发送过信号，不能当作进程实际退出的依据。
 * 生命周期编排必须等待 exit，才能保证父进程退出后不留下孤儿进程。
 */
export function waitForManagedProcessExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let finished = false;
    const finish = (exited: boolean): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(exited);
    };
    const onExit = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
  });
}

/** 以平台正确的方式回收一个受管子进程及其子树。 */
export async function forceTerminateManagedProcessTree(
  child: ChildProcess,
  label: string,
  timeoutMs = 1500,
  ownsProcessGroup = false,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (process.platform === 'win32' && child.pid) {
    logger.warn('受管进程未按时退出，强制回收 Windows 进程树', { label, pid: child.pid });
    await runWindowsTaskKill(child.pid);
  } else if (ownsProcessGroup && child.pid) {
    logger.warn('受管进程组未按时退出，发送 SIGKILL', { label, pid: child.pid });
    if (!signalPosixProcessGroup(child.pid, 'SIGKILL', label)) {
      child.kill('SIGKILL');
    }
  } else {
    logger.warn('受管进程未按时退出，发送 SIGKILL', { label, pid: child.pid });
    child.kill('SIGKILL');
  }

  await waitForManagedProcessExit(child, timeoutMs);
}

/**
 * 请求子进程优雅停止，并在期限到达后兜底回收进程树。
 *
 * 对于有协议级 shutdown 的子进程，调用方可先自行发送协议，再直接使用
 * `waitForManagedProcessExit` / `forceTerminateManagedProcessTree` 两个基础步骤。
 */
export async function stopManagedProcess(
  child: ChildProcess | null | undefined,
  options: ManagedProcessStopOptions,
): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const gracefulTimeoutMs = options.gracefulTimeoutMs ?? 5000;
  const forceTimeoutMs = options.forceTimeoutMs ?? 1500;
  const ownsProcessGroup = options.ownsProcessGroup ?? false;

  // Windows 的 SIGTERM 只会结束 uv/cmd 这类启动外壳，Python 或其他实际工作进程
  // 可能在外壳先退出后脱离进程树。对没有独立协议停机步骤的受管进程，直接按根 PID
  // 回收整棵树，才是可验证的终止语义。
  if (process.platform === 'win32' && child.pid) {
    logger.info('回收 Windows 受管进程树', { label: options.label, pid: child.pid });
    await runWindowsTaskKill(child.pid);
    await waitForManagedProcessExit(child, forceTimeoutMs);
    return;
  }

  if (ownsProcessGroup && child.pid) {
    if (!signalPosixProcessGroup(child.pid, 'SIGTERM', options.label)) {
      child.kill('SIGTERM');
    }
  } else {
    child.kill('SIGTERM');
  }
  if (await waitForManagedProcessExit(child, gracefulTimeoutMs)) {
    return;
  }

  await forceTerminateManagedProcessTree(
    child,
    options.label,
    forceTimeoutMs,
    ownsProcessGroup,
  );
}

function signalPosixProcessGroup(
  pid: number,
  signal: NodeJS.Signals,
  label: string,
): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'ESRCH') {
      return true;
    }
    logger.error('发送受管进程组信号失败', {
      label,
      pid,
      signal,
      error_code: code,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function runWindowsTaskKill(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.once('error', (error) => {
      logger.error('Windows 进程树回收命令执行失败', { pid, error: error.message });
      resolve();
    });
    killer.once('exit', () => resolve());
  });
}
