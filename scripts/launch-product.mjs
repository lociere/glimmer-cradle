import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolvePnpmInvocation } from './lib/package-manager-command.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageManager = resolvePnpmInvocation({
  platform: process.platform,
  execPath: process.execPath,
  repoRoot,
});
const productId = process.argv[2] || 'desktop';
const kernelOnly = process.argv.includes('--kernel-only');
const production = process.argv.includes('--production');
const productPackages = {
  desktop: '@glimmer-cradle/desktop',
  'personal-server': '@glimmer-cradle/personal-server',
};
const productPackage = productPackages[productId];
if (!productPackage) {
  throw new Error(`未知产品组合: ${productId}`);
}

if (!production) await runPreparation();

const productManifest = path.join(repoRoot, 'products', productId, 'product.json');
const sharedEnvironment = {
  ...process.env,
  GLIMMER_CRADLE_PRODUCT_MANIFEST: productManifest,
  GLIMMER_CRADLE_EXTENSION_MODULE_ROOT: path.join(repoRoot, 'build', 'extension-host', 'modules'),
};
const children = new Map();
let shuttingDown = false;
let requestedExitCode = 0;
const services = [
  {
    id: 'kernel',
    args: ['--filter', '@glimmer-cradle/kernel', production ? 'start:built' : 'dev'],
  },
  ...kernelOnly ? [] : [{
    id: productId,
    args: ['--filter', productPackage, production
      ? 'start'
      : productId === 'desktop' ? 'dev:electron' : 'dev'],
  }],
];

for (const service of services) {
  const child = spawn(packageManager.command, [...packageManager.prefix, ...service.args], {
    cwd: repoRoot,
    stdio: 'inherit',
    windowsHide: true,
    detached: process.platform !== 'win32',
    env: sharedEnvironment,
  });
  children.set(service.id, child);
  child.once('error', (error) => {
    console.error(`[product-supervisor] ${service.id} 启动失败:`, error);
    requestedExitCode = 1;
    void shutdown();
  });
  child.once('exit', (code, signal) => {
    children.delete(service.id);
    if (!shuttingDown) {
      const cleanExit = code === 0 && signal === null;
      const message = `[product-supervisor] ${service.id} 已退出 (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
      if (cleanExit) console.info(message);
      else console.error(message);
      requestedExitCode = cleanExit ? 0 : code && code !== 0 ? code : 1;
      void shutdown(requestedExitCode, cleanExit ? 3000 : 0);
    }
  });
}

process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));
process.once('SIGHUP', () => void shutdown(0));

async function runPreparation() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'prepare-runtime.mjs')], {
      cwd: repoRoot,
      stdio: 'inherit',
      windowsHide: true,
      env: process.env,
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`运行准备失败: ${code ?? 1}`)));
  });
}

async function shutdown(exitCode = requestedExitCode, gracefulWaitMs = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  requestedExitCode = exitCode;
  if (gracefulWaitMs > 0) {
    await waitForChildrenToExit(gracefulWaitMs);
  }
  await Promise.allSettled([...children.values()].map((child) => terminateTree(child.pid)));
  process.exit(requestedExitCode);
}

async function waitForChildrenToExit(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (children.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function terminateTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => resolve());
      killer.once('exit', () => resolve());
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}
