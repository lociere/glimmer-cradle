import { spawn } from 'node:child_process';
import process from 'node:process';

const defaultDelay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function terminateProcessTree(pid, {
  platform = process.platform,
  spawnProcess = spawn,
  killProcess = process.kill.bind(process),
  delay = defaultDelay,
} = {}) {
  if (!pid) return;
  if (platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawnProcess('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', resolve);
      killer.once('exit', resolve);
    });
    return;
  }
  try {
    killProcess(-pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
    return;
  }
  await delay(2500);
  try {
    killProcess(-pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}
