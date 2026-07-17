import { spawn } from 'node:child_process';
import process from 'node:process';

const appRoot = process.env.GLIMMER_CRADLE_APP_ROOT || '/opt/glimmer-cradle/app';
const services = [
  { id: 'kernel', entry: `${appRoot}/core/kernel/dist/index.js` },
  { id: 'personal-server', entry: `${appRoot}/products/personal-server/dist/index.js` },
];
const children = new Map();
let shuttingDown = false;

for (const service of services) {
  const child = spawn(process.execPath, [service.entry], {
    cwd: appRoot,
    env: process.env,
    stdio: 'inherit',
    detached: true,
  });
  children.set(service.id, child);
  child.once('error', (error) => {
    console.error(`[personal-server-supervisor] ${service.id} 启动失败`, error);
    void shutdown(1);
  });
  child.once('exit', (code, signal) => {
    children.delete(service.id);
    if (shuttingDown) return;
    console.error(
      `[personal-server-supervisor] ${service.id} 意外退出 (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
    );
    void shutdown(code && code !== 0 ? code : 1);
  });
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => void shutdown(0));
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.values()) signalGroup(child.pid, 'SIGTERM');
  await waitForExit(20_000);
  for (const child of children.values()) signalGroup(child.pid, 'SIGKILL');
  process.exit(exitCode);
}

async function waitForExit(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (children.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function signalGroup(pid, signal) {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}
