import { spawn } from 'node:child_process';
import process from 'node:process';
import { ChildExitError } from './errors.mjs';
import { terminateProcessTree } from './process-tree.mjs';

const defaultDelay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function runPreparation(plan, { spawnProcess }) {
  if (!plan.preparation) return;
  const { command, args } = plan.preparation;
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      cwd: plan.repositoryRoot,
      stdio: 'inherit',
      windowsHide: true,
      env: process.env,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code === 0 && signal === null ? 0 : code ?? 1));
  });
  if (exitCode !== 0) throw new ChildExitError('产品准备失败', exitCode);
}

export async function superviseWorkspace(plan, {
  spawnProcess = spawn,
  signalSource = process,
  environment = process.env,
  platform = process.platform,
  terminateTree = (pid) => terminateProcessTree(pid, { platform }),
  delay = defaultDelay,
  gracefulWaitMs = 3000,
  logger = console,
} = {}) {
  await runPreparation(plan, { spawnProcess });

  const children = new Map();
  let shuttingDown = false;
  let finish;
  const completion = new Promise((resolve) => { finish = resolve; });
  const signalHandlers = new Map();

  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) signalSource.removeListener(signal, handler);
    signalHandlers.clear();
  };
  const shutdown = async (exitCode, waitForSibling) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (waitForSibling && gracefulWaitMs > 0) await delay(gracefulWaitMs);
    await Promise.allSettled([...children.values()].map((child) => terminateTree(child.pid)));
    removeSignalHandlers();
    finish(exitCode);
  };

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => void shutdown(0, false);
    signalHandlers.set(signal, handler);
    signalSource.once(signal, handler);
  }

  for (const service of plan.services) {
    const child = spawnProcess(service.command, service.args, {
      cwd: plan.repositoryRoot,
      stdio: 'inherit',
      windowsHide: true,
      detached: platform !== 'win32',
      env: { ...environment, ...plan.environment },
    });
    children.set(service.id, child);
    child.once('error', (error) => {
      logger.error(`[workspace-supervisor] ${service.id} 启动失败:`, error);
      void shutdown(1, false);
    });
    child.once('exit', (code, signal) => {
      children.delete(service.id);
      if (shuttingDown) return;
      const cleanExit = code === 0 && signal === null;
      const message = `[workspace-supervisor] ${service.id} 已退出 (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
      (cleanExit ? logger.info : logger.error)(message);
      void shutdown(cleanExit ? 0 : code && code !== 0 ? code : 1, cleanExit);
    });
  }

  return completion;
}
