import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

if (process.platform !== 'win32') throw new Error('Desktop process-tree projection requires Windows');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// Invoke the owner's published build script instead of importing package internals.
await new Promise((resolve, reject) => {
  const child = spawn('pnpm.cmd --filter @glimmer-cradle/platform run build:native', {
    cwd: repoRoot, stdio: 'inherit', windowsHide: true, shell: true,
  });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error('Platform native build failed: ' + code)));
});
const mechanism = path.join(repoRoot, 'build/components/native/composition-host/windows-x64/PlatformProcessTreeBridge.exe');
const output = path.join(path.dirname(mechanism), 'DesktopProcessTreeBridge.exe');
// Preserve the current Desktop package filename until the P12B product projection switch.
await copyFile(mechanism, output);
process.stdout.write(JSON.stringify({ event: 'desktop_process_tree_helper_built', output }) + '\n');
