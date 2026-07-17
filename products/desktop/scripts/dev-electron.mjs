#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const VITE_DEV_SERVER_URL = process.env.GLIMMER_CRADLE_RENDERER_DEV_SERVER_URL ?? 'http://127.0.0.1:5173';
const VITE_READY_URL = `${VITE_DEV_SERVER_URL}/presence.html`;
const KERNEL_READY_URL = process.env.GLIMMER_CRADLE_DESKTOP_UI_WS_URL ?? '';
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..');
const ENDPOINT_CATALOG_PATH = path.join(
  process.env.GLIMMER_CRADLE_RUN_ROOT
    ? path.resolve(REPO_ROOT, process.env.GLIMMER_CRADLE_RUN_ROOT)
    : path.join(
      process.env.GLIMMER_CRADLE_DATA_ROOT
        ? path.resolve(REPO_ROOT, process.env.GLIMMER_CRADLE_DATA_ROOT)
        : path.join(REPO_ROOT, 'data'),
      'run',
    ),
  'host',
  'endpoints.json',
);
const VITE_READY_TIMEOUT_MS = 45_000;
const VITE_READY_INTERVAL_MS = 250;
const KERNEL_READY_TIMEOUT_MS = readPositiveIntEnv('GLIMMER_CRADLE_KERNEL_READY_TIMEOUT_MS', 20 * 60_000);
const KERNEL_READY_INTERVAL_MS = 250;
const isWindows = process.platform === 'win32';
const children = new Set();
let shuttingDown = false;
let outputClosed = false;
let startupFailure = null;
let shutdownPromise = null;

function handleBrokenPipe() {
  outputClosed = true;
  shutdown(0);
}

function ignoreBrokenPipe(stream) {
  stream.on('error', (error) => {
    if (error?.code === 'EPIPE') {
      handleBrokenPipe();
      return;
    }
    throw error;
  });
}

ignoreBrokenPipe(process.stdout);
ignoreBrokenPipe(process.stderr);

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function safeWrite(stream, text) {
  if (outputClosed || !stream.writable) return;
  try {
    stream.write(text);
  } catch (error) {
    if (error?.code === 'EPIPE') {
      handleBrokenPipe();
      return;
    }
    throw error;
  }
}

function bin(name) {
  return path.join(PKG_ROOT, 'node_modules', '.bin', isWindows ? `${name}.cmd` : name);
}

function spawnManaged(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: PKG_ROOT,
    env: options.env ?? process.env,
    shell: isWindows,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  children.add(child);
  child.stdout?.on('data', (chunk) => safeWrite(process.stdout, `[${label}] ${chunk}`));
  child.stderr?.on('data', (chunk) => safeWrite(process.stderr, `[${label}] ${chunk}`));
  child.on('error', (error) => {
    startupFailure ??= new Error(`${label} failed to start: ${error.message}`);
    safeWrite(process.stderr, `[${label}] failed to start: ${error.message}\n`);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown && options.exitBehavior === 'shutdown') {
      shutdown(code ?? (signal ? 1 : 0));
      return;
    }
    if (!shuttingDown && code && code !== 0) {
      const exitReason = `${label} exited before startup completed (code ${code}${signal ? `, signal ${signal}` : ''})`;
      startupFailure ??= new Error(exitReason);
      safeWrite(process.stderr, `[${label}] ${exitReason}\n`);
      shutdown(code);
    }
  });
  return child;
}

function runOnce(label, command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PKG_ROOT,
      shell: isWindows,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk) => safeWrite(process.stdout, `[${label}] ${chunk}`));
    child.stderr?.on('data', (chunk) => safeWrite(process.stderr, `[${label}] ${chunk}`));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with code ${code ?? 1}`));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probeHttp(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 1_000 }, (response) => {
      response.resume();
      response.on('end', () => {
        resolve({
          ok: response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 400,
          statusCode: response.statusCode,
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });
    request.on('error', (error) => {
      resolve({ ok: false, error });
    });
  });
}

function parseTcpEndpoint(url) {
  const parsed = new URL(url);
  const port = Number(parsed.port || (parsed.protocol === 'wss:' ? 443 : 80));
  return {
    host: parsed.hostname,
    port,
  };
}

function probeTcp({ host, port }) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(1_000);

    socket.on('connect', () => {
      socket.destroy();
      resolve({ ok: true });
    });
    socket.on('timeout', () => {
      socket.destroy(new Error('timeout'));
    });
    socket.on('error', (error) => {
      resolve({ ok: false, error });
    });
  });
}

async function waitForVite() {
  const deadline = Date.now() + VITE_READY_TIMEOUT_MS;
  let lastStatus = 'not reached';

  safeWrite(process.stdout, `[dev-electron] waiting for Vite at ${VITE_READY_URL}\n`);
  while (Date.now() < deadline && !shuttingDown) {
    const result = await probeHttp(VITE_READY_URL);
    if (result.ok) {
      safeWrite(process.stdout, `[dev-electron] Vite is ready (${VITE_READY_URL})\n`);
      return;
    }

    lastStatus = result.statusCode
      ? `HTTP ${result.statusCode}`
      : result.error?.message ?? 'not reached';
    await delay(VITE_READY_INTERVAL_MS);
  }

  if (startupFailure) throw startupFailure;

  throw new Error(`Vite did not serve ${VITE_READY_URL} within ${VITE_READY_TIMEOUT_MS}ms; last status: ${lastStatus}`);
}

async function waitForKernel() {
  const deadline = Date.now() + KERNEL_READY_TIMEOUT_MS;
  let lastStatus = 'not reached';

  safeWrite(
    process.stdout,
    `[dev-electron] waiting for Kernel control surface endpoint (timeout ${KERNEL_READY_TIMEOUT_MS}ms)\n`,
  );
  while (Date.now() < deadline && !shuttingDown) {
    const url = KERNEL_READY_URL || await discoverKernelDesktopEndpoint();
    if (!url) {
      lastStatus = `endpoint catalog not ready: ${ENDPOINT_CATALOG_PATH}`;
      await delay(KERNEL_READY_INTERVAL_MS);
      continue;
    }
    const endpoint = parseTcpEndpoint(url);
    const result = await probeTcp(endpoint);
    if (result.ok) {
      safeWrite(
        process.stdout,
        `[dev-electron] Kernel control surface is ready (${url})\n`,
      );
      return;
    }

    lastStatus = result.error?.message ?? 'not reached';
    await delay(KERNEL_READY_INTERVAL_MS);
  }

  if (startupFailure) throw startupFailure;

  throw new Error(
    `Kernel control surface endpoint did not become ready within ${KERNEL_READY_TIMEOUT_MS}ms; last status: ${lastStatus}`,
  );
}

async function discoverKernelDesktopEndpoint() {
  try {
    const catalog = JSON.parse(await fs.readFile(ENDPOINT_CATALOG_PATH, 'utf8'));
    if (!isProcessAlive(Number(catalog.owner_pid))) return '';
    const record = Array.isArray(catalog.endpoints)
      ? catalog.endpoints.find((item) => item?.purpose === 'control-surface')
      : null;
    return typeof record?.endpoint === 'string' && record.endpoint.startsWith('ws://127.0.0.1:')
      ? record.endpoint
      : '';
  } catch {
    return '';
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function shutdown(code = 0) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = (async () => {
    await Promise.all([...children].map((child) => terminateManagedChild(child)));
    process.exit(code);
  })();
  return shutdownPromise;
}

async function terminateManagedChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  if (isWindows && child.pid) {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('error', resolve);
      killer.once('exit', resolve);
    });
    return;
  }

  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(1500),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (error) => {
  if (error?.code === 'EPIPE') {
    handleBrokenPipe();
    return;
  }
  safeWrite(process.stderr, `[dev-electron] uncaught exception: ${error.stack ?? error.message}\n`);
  shutdown(1);
});
process.on('unhandledRejection', (reason) => {
  safeWrite(process.stderr, `[dev-electron] unhandled rejection: ${String(reason)}\n`);
  shutdown(1);
});

try {
  await runOnce('tsc:main', bin('tsc'), ['-p', 'tsconfig.main.json']);
  await runOnce('tsc:preload', bin('tsc'), ['-p', 'tsconfig.preload.json']);

  const existingVite = await probeHttp(VITE_READY_URL);
  if (existingVite.ok) {
    safeWrite(process.stdout, `[dev-electron] reusing existing Vite at ${VITE_READY_URL}\n`);
  } else {
    spawnManaged('vite', bin('vite'), []);
  }
  spawnManaged('tsc:main', bin('tsc'), ['-p', 'tsconfig.main.json', '--watch', '--preserveWatchOutput']);
  spawnManaged('tsc:preload', bin('tsc'), ['-p', 'tsconfig.preload.json', '--watch', '--preserveWatchOutput']);
  await Promise.all([waitForVite(), waitForKernel()]);
  spawnManaged('electron', process.execPath, ['scripts/run-electron.mjs'], {
    env: {
      ...process.env,
      GLIMMER_CRADLE_RENDERER_DEV_SERVER_URL: VITE_DEV_SERVER_URL,
    },
    exitBehavior: 'shutdown',
  });
} catch (error) {
  safeWrite(process.stderr, `[dev-electron] startup failed: ${error.message}\n`);
  shutdown(1);
}
